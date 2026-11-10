import { compact, DEFAULT_COMPACTION_SETTINGS } from '@earendil-works/pi-coding-agent';
import type { ExtensionContext, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { CONVERSATION_MODEL, type ThinkingLevel, type Tuple } from './config.ts';

/**
 * Every type this module needs is derived from `compact()`'s own signature. That signature is one
 * of the two seams checked at activation, so deriving from it keeps the check and the call in step.
 */
type CompactArguments = Parameters<typeof compact>;
export type SummarizerModel = CompactArguments[1];
export type SummarizerStream = NonNullable<CompactArguments[7]>;
/** The host does not export this name; `compact()`'s first parameter is the same type. */
export type SummarizationPreparation = CompactArguments[0];
type StreamOptions = NonNullable<Parameters<SummarizerStream>[2]>;

const LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * APIs whose output option is the answer budget, with the adapter adding the thinking budget on
 * top. Everywhere else the output option is one pool covering reasoning and text, so the two
 * budgets are passed as their sum. An API this package has not read is treated as one pool, which
 * bounds the request on every adapter rather than only on the ones we know.
 */
const ANSWER_BUDGET_APIS = new Set(['anthropic-messages', 'bedrock-converse-stream', 'google-generative-ai', 'google-vertex']);

/** The host estimates a compaction summary at four characters per token. */
export const estimateSummaryTokens = (summary: string): number => Math.ceil(summary.length / 4);

export interface OutputBudgets {
  maxTokens: number;
  thinkingBudgets?: { minimal: number; low: number; medium: number; high: number };
}

/**
 * The two budgets mapped onto whatever the model's adapter exposes, such that their sum is the
 * ceiling. The reasoning budget is absolute, so it is set for every level: an adapter that clamps
 * the requested level must not fall back to its own default budget.
 */
export function outputBudgets(model: SummarizerModel, tuple: Tuple, thinking: ThinkingLevel): OutputBudgets {
  const reasoning = thinking === 'off' ? 0 : tuple.reasoningBudget;
  const budgets: OutputBudgets = {
    maxTokens: ANSWER_BUDGET_APIS.has(model.api) ? tuple.textBudget : tuple.textBudget + reasoning,
  };
  if (reasoning > 0) {
    budgets.thinkingBudgets = { minimal: reasoning, low: reasoning, medium: reasoning, high: reasoning };
  }
  return budgets;
}

/** The host's own clamping: prefer a higher supported level, then a lower one. */
export function clampThinkingLevel(model: SummarizerModel, level: ThinkingLevel): ThinkingLevel {  const available = supportedThinkingLevels(model);
  if (available.includes(level)) return level;
  const requested = LEVELS.indexOf(level);
  if (requested === -1) return available[0] ?? 'off';
  for (let index = requested; index < LEVELS.length; index++) {
    if (available.includes(LEVELS[index]!)) return LEVELS[index]!;
  }
  for (let index = requested - 1; index >= 0; index--) {
    if (available.includes(LEVELS[index]!)) return LEVELS[index]!;
  }
  return available[0] ?? 'off';
}

function supportedThinkingLevels(model: SummarizerModel): ThinkingLevel[] {
  const map = (model as { reasoning?: boolean; thinkingLevelMap?: Record<string, unknown> });
  if (!map.reasoning) return ['off'];
  return LEVELS.filter((level) => {
    const mapped = map.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    return level === 'xhigh' || level === 'max' ? mapped !== undefined : true;
  });
}

/** A zero reasoning budget means the summarizer does not reason, whatever level the preset names. */
export function summarizerThinkingLevel(model: SummarizerModel, tuple: Tuple): ThinkingLevel {
  return clampThinkingLevel(model, tuple.reasoningBudget === 0 ? 'off' : tuple.thinking);
}

export function resolveSummarizerModel(tuple: Tuple, ctx: ExtensionContext): SummarizerModel | undefined {
  if (tuple.model === CONVERSATION_MODEL) return ctx.model;
  const separator = tuple.model.indexOf('/');
  return ctx.modelRegistry.find(tuple.model.slice(0, separator), tuple.model.slice(separator + 1));
}

/**
 * The injection point: the host hands its summarization request options straight through, with no
 * output ceiling of its own, and this is where the two budgets are added.
 */
export function boundedStream(registry: ModelRegistry, budgets: OutputBudgets): SummarizerStream {
  return ((model: SummarizerModel, context: unknown, options?: StreamOptions) =>
    registry.streamSimple(model, context as never, {
      ...options,
      maxTokens: budgets.maxTokens,
      ...(budgets.thinkingBudgets ? { thinkingBudgets: budgets.thinkingBudgets } : {}),
    })) as unknown as SummarizerStream;
}

export interface SeamResult {
  ok: boolean;
  detail: string;
}

/**
 * `compact()`'s argument list and the point at which it calls its stream function are not
 * documented extension APIs, so they are checked rather than assumed — with an actual call through
 * a stream function we supply, which needs no credentials and makes no request. A mismatch hands
 * compaction back to the host instead of letting the package misbehave.
 */
export async function checkHostSeam(compactFn: typeof compact = compact): Promise<SeamResult> {
  if (compactFn.length !== 12) {
    return { ok: false, detail: `compact() takes ${compactFn.length} arguments, not 12` };
  }
  const seen: unknown[] = [];
  const stream: SummarizerStream = ((_model: unknown, _context: unknown, options?: StreamOptions) => {
    seen.push(options);
    return { result: async () => probeResponse() } as never;
  }) as unknown as SummarizerStream;
  try {
    await compactFn(probePreparation(), probeModel(), undefined, undefined, undefined, undefined, 'off', stream);
  } catch (error) {
    return { ok: false, detail: `compact() rejected a supplied stream function: ${String(error)}` };
  }
  const options = seen[0];
  if (seen.length !== 1 || !options || typeof options !== 'object') {
    return { ok: false, detail: `the supplied stream function was called ${seen.length} times with ${typeof options} options` };
  }
  return { ok: true, detail: `compact() arity 12; our stream function received {${Object.keys(options).sort().join(', ')}}` };
}

function probeModel(): SummarizerModel {
  return {
    id: 'pi-compaction-seam-probe',
    provider: 'pi-compaction-seam-probe',
    name: 'pi-compaction seam probe',
    api: 'pi-compaction-seam-probe',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_000,
    maxTokens: 1_000,
  } as unknown as SummarizerModel;
}

function probePreparation(): SummarizationPreparation {
  return {
    firstKeptEntryId: 'pi-compaction-seam-probe',
    messagesToSummarize: [{ role: 'user', content: 'seam probe', timestamp: Date.now() }],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 0,
    fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
    settings: DEFAULT_COMPACTION_SETTINGS,
  } as SummarizationPreparation;
}

function probeResponse() {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'seam probe' }],
    stopReason: 'stop',
    provider: 'pi-compaction-seam-probe',
    model: 'pi-compaction-seam-probe',
    timestamp: Date.now(),
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
