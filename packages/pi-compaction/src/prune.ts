import { calculateContextTokens, DEFAULT_COMPACTION_SETTINGS, estimateTokens, shouldCompact } from '@earendil-works/pi-coding-agent';
import type { ContextEditEntryDraft, ContextUsage, ExtensionAPI, ProjectedSessionEntry } from '@earendil-works/pi-coding-agent';

type ProjectedMessage = ProjectedSessionEntry['messages'][number];
type HostSettings = ReturnType<ExtensionAPI['getSettings']>;

/**
 * Prune: shrink context by replacing an old tool result with a bounded placeholder, keeping the
 * originating tool call. No model call and no summary, so it is not a compaction.
 *
 * Per ADR 0002 a prune is a persisted `context_edit` session entry carrying a replacement — never
 * an omission, which would leave the originating tool call orphaned and produce a shape providers
 * reject, and never a rewrite of the outgoing message list, which one of the host's two compaction
 * triggers would not see. The raw entry is never modified, so a pruned result is still on disk;
 * nothing in this package reads it back, because a recall tool is out of scope and recovery is by
 * re-running the tool.
 */

/** The excerpt a placeholder keeps. A constant, not a knob: it only has to show whether a re-run is worth it. */
export const PLACEHOLDER_EXCERPT_CHARS = 600;

/**
 * The argument digest is a re-run aid. The full arguments live on the preserved tool call, so the
 * placeholder repeats only enough of them to name the call.
 */
export const ARGUMENT_DIGEST_CHARS = 240;

/**
 * Fallback only, for a provider that reports no cache usage at all. The gate's real signal is the
 * usage the host recorded for the previous request, which self-calibrates across providers whose
 * cache lifetimes differ; this is a clock, so it is deliberately the same five minutes the host
 * itself treats as a prompt-cache TTL.
 */
export const CACHE_TTL_FALLBACK_MS = 5 * 60 * 1000;

// ============================================================================
// The two gates
// ============================================================================

/** Which gate permitted a prune. `cache-ttl-fallback` is the clock, and only when usage is absent. */
export type PruneGateName = 'cache-miss' | 'compaction-imminent' | 'cache-ttl-fallback';

export interface PruneGate {
  armed: boolean;
  gate?: PruneGateName;
  /** What decided it, reported verbatim by the status view and by every prune. */
  detail: string;
}

/** What the host recorded for the request that just completed. */
export interface RequestObservation {
  usage?: { cacheRead: number; cacheWrite: number };
  /** The assistant message's own timestamp, in milliseconds. */
  timestamp?: number;
}

/**
 * Either gate permits a prune; neither, and nothing is pruned.
 *
 * The cache gate is a measured fact rather than a clock: a request that read no cached prompt
 * tokens paid full price for its whole prefix, so invalidating that prefix costs nothing that was
 * not already being paid. A request that read cached tokens has a warm prefix, and a prune inside it
 * would buy tokens with a full-price prefill.
 */
export function evaluatePruneGate(
  request: RequestObservation | undefined,
  compactionImminent: boolean,
  now: number,
): PruneGate {
  if (compactionImminent) {
    return {
      armed: true,
      gate: 'compaction-imminent',
      detail: 'compaction is imminent, so the prefix is about to be destroyed and invalidating it is free',
    };
  }
  const usage = request?.usage;
  if (usage && usage.cacheRead + usage.cacheWrite > 0) {
    return usage.cacheRead === 0
      ? {
        armed: true,
        gate: 'cache-miss',
        detail: `the previous request read no cached prompt tokens and wrote ${usage.cacheWrite}, so its prefix is already cold`,
      }
      : {
        armed: false,
        detail: `the previous request read ${usage.cacheRead} cached prompt tokens, so its prefix is warm`,
      };
  }
  if (request?.timestamp === undefined) {
    return { armed: false, detail: 'no completed request has been observed yet, so nothing says whether the cache is cold' };
  }
  const age = now - request.timestamp;
  return age > CACHE_TTL_FALLBACK_MS
    ? {
      armed: true,
      gate: 'cache-ttl-fallback',
      detail: `the previous request reported no cache usage and was ${seconds(age)}s ago, past the ${seconds(CACHE_TTL_FALLBACK_MS)}s fallback TTL`,
    }
    : {
      armed: false,
      detail: `the previous request reported no cache usage and was ${seconds(age)}s ago, inside the ${seconds(CACHE_TTL_FALLBACK_MS)}s fallback TTL`,
    };
}

const seconds = (ms: number) => Math.round(ms / 1000);

/** The observation one assistant message yields, using the host's own rule for usable usage. */
function requestObservation(message: ProjectedMessage): RequestObservation | undefined {
  if (message.role !== 'assistant') return undefined;
  const usable = message.stopReason !== 'aborted'
    && message.stopReason !== 'error'
    && message.usage
    && calculateContextTokens(message.usage) > 0;
  // An aborted, failed or usage-less response says nothing about the cache, so it is not an
  // observation at all — the request before it is the last one that measured anything.
  return usable
    ? { usage: { cacheRead: message.usage.cacheRead, cacheWrite: message.usage.cacheWrite }, timestamp: message.timestamp }
    : undefined;
}

/** The most recent request whose usage the host would count. */
export function lastRequest(entries: readonly ProjectedSessionEntry[]): RequestObservation | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const messages = entries[index].messages;
    for (let at = messages.length - 1; at >= 0; at--) {
      const observed = requestObservation(messages[at]);
      if (observed) return observed;
    }
  }
  return undefined;
}

export interface HostCompactionTrigger {
  enabled: boolean;
  reserveTokens: number;
}

/**
 * The host's own compaction trigger, so "imminent" means what the host means by it.
 *
 * shortcut: this repeats the host's resolution of `compaction.reserveTokens` — per-model override,
 * then the ordinary setting, then the built-in default — because an extension is handed the raw
 * merged settings rather than the resolved ones. Read the resolved trigger from the extension API
 * when the host exposes one.
 */
export function hostCompactionTrigger(
  settings: HostSettings,
  model: { provider: string; id: string } | undefined,
): HostCompactionTrigger {
  const compaction = settings.compaction;
  const override = model ? compaction?.modelOverrides?.[`${model.provider}/${model.id}`] : undefined;
  return {
    enabled: compaction?.enabled ?? DEFAULT_COMPACTION_SETTINGS.enabled,
    reserveTokens: override?.reserveTokens ?? compaction?.reserveTokens ?? DEFAULT_COMPACTION_SETTINGS.reserveTokens,
  };
}

/** Whether the host's own threshold test is already satisfied, so the next response compacts. */
export function isCompactionImminent(usage: ContextUsage | undefined, trigger: HostCompactionTrigger): boolean {
  if (!usage || usage.tokens === null) return false;
  return shouldCompact(usage.tokens, usage.contextWindow, { ...trigger, keepRecentTokens: 0 });
}

// ============================================================================
// The plan
// ============================================================================

export interface PrunePlanInput {
  /** The session projection, oldest entry first. */
  entries: readonly ProjectedSessionEntry[];
  /** Targets that already carry a context edit; a result is pruned at most once. */
  editedTargetIds: ReadonlySet<string>;
  neverPrune: readonly string[];
  pruneWindowTokens: number;
}

export interface PrunePlan {
  /** Drafts to return from one boundary handler, so a turn's prunes are appended together. */
  edits: ContextEditEntryDraft[];
  /** The pruned entry ids, oldest first. */
  prunedEntryIds: string[];
  /** The distinct tool names pruned, for the report line. */
  toolNames: string[];
  omittedChars: number;
}

/**
 * Every prunable result older than the protected window, oldest first.
 *
 * The window is denominated in tokens of recent tool-result context: walking back from the newest
 * result, a result is protected while the results newer than it are still worth fewer than
 * `pruneWindowTokens` tokens. Everything older is a candidate, which is the position that saves the
 * most tokens and invalidates the most cache — acceptable precisely because a gate had to permit it.
 */
export function planPrune({ entries, editedTargetIds, neverPrune, pruneWindowTokens }: PrunePlanInput): PrunePlan {
  const blocked = new Set(neverPrune);
  // The arguments stay on the preserved assistant tool call; the placeholder carries only a digest.
  const calls = new Map<string, { arguments: unknown }>();
  for (const entry of entries) {
    for (const message of entry.messages) {
      if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        const call = block as { type?: string; id?: string; arguments?: unknown };
        if (call?.type === 'toolCall' && typeof call.id === 'string') calls.set(call.id, { arguments: call.arguments });
      }
    }
  }

  const plan: PrunePlan = { edits: [], prunedEntryIds: [], toolNames: [], omittedChars: 0 };
  let newerTokens = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    const results = entry.messages.filter((message) => message.role === 'toolResult');
    if (results.length === 0) continue;
    const beyondWindow = newerTokens >= pruneWindowTokens;
    newerTokens += results.reduce((sum, message) => sum + estimateTokens(message), 0);
    if (!beyondWindow) continue;

    const source = entry.sourceEntry;
    if (source.type !== 'message' || source.message.role !== 'toolResult') continue;
    if (editedTargetIds.has(source.id)) continue;
    const result = source.message;
    if (blocked.has(result.toolName)) continue;

    const built = placeholder(result.toolName, result.content, calls.get(result.toolCallId));
    // A placeholder that is not smaller than the text it replaces is not a prune.
    if (built.otherBlocks === 0 && built.text.length >= built.originalChars) continue;

    plan.edits.push({
      type: 'context_edit',
      targetId: source.id,
      // A replacement, never null: null omits the entry and orphans the originating tool call.
      replacement: { content: [{ type: 'text', text: built.text }] },
    });
    plan.prunedEntryIds.push(source.id);
    if (!plan.toolNames.includes(result.toolName)) plan.toolNames.push(result.toolName);
    plan.omittedChars += built.originalChars - built.excerptChars;
  }
  plan.edits.reverse();
  plan.prunedEntryIds.reverse();
  return plan;
}

// ============================================================================
// The placeholder
// ============================================================================

/**
 * Names the tool, digests its arguments so a re-run is possible, states how much was omitted and
 * keeps a bounded excerpt. It does not repeat the full arguments: they are on the preserved tool
 * call, which is what makes the result recoverable at all.
 */
export function placeholder(
  toolName: string,
  content: unknown,
  call: { arguments: unknown } | undefined,
): { text: string; originalChars: number; excerptChars: number; otherBlocks: number } {
  const { text: original, otherBlocks } = flatten(content);
  const excerpt = original.slice(0, PLACEHOLDER_EXCERPT_CHARS);
  const lines = [
    '[pi-compaction pruned this tool result]',
    `Tool: ${toolName}`,
    `Arguments: ${call ? digest(call.arguments) : 'see the preserved tool call above'}`,
    `Omitted: ${original.length - excerpt.length} of ${original.length} characters.`,
  ];
  if (otherBlocks > 0) lines.push(`Non-text content dropped: ${otherBlocks} block(s).`);
  if (excerpt.length > 0) {
    lines.push(`Excerpt (first ${excerpt.length} characters):`, excerpt);
  }
  lines.push(
    `Re-run \`${toolName}\` with those arguments to recover the full result; ` +
    'it is unchanged on disk in this session.',
  );
  return {
    text: lines.join('\n'),
    originalChars: original.length,
    excerptChars: excerpt.length,
    otherBlocks,
  };
}

function flatten(content: unknown): { text: string; otherBlocks: number } {
  if (typeof content === 'string') return { text: content, otherBlocks: 0 };
  if (!Array.isArray(content)) return { text: '', otherBlocks: 0 };
  let text = '';
  let otherBlocks = 0;
  for (const block of content) {
    const record = block as { type?: string; text?: unknown } | null;
    if (record && typeof record === 'object' && record.type === 'text') text += String(record.text ?? '');
    else otherBlocks++;
  }
  return { text, otherBlocks };
}

function digest(args: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(args) ?? String(args);
  } catch {
    serialized = String(args);
  }
  return serialized.length <= ARGUMENT_DIGEST_CHARS
    ? serialized
    : `${serialized.slice(0, ARGUMENT_DIGEST_CHARS)}… (truncated; the full arguments are on the preserved tool call)`;
}

/** Every target on the branch that already carries a context edit, pruned or not. */
export function editedTargets(branch: readonly { type: string; targetId?: string }[]): Set<string> {
  const targets = new Set<string>();
  for (const entry of branch) {
    if (entry.type === 'context_edit' && typeof entry.targetId === 'string') targets.add(entry.targetId);
  }
  return targets;
}
