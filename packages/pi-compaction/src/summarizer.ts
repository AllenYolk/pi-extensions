import { compact, DEFAULT_COMPACTION_SETTINGS } from '@earendil-works/pi-coding-agent';
import type { ExtensionContext, ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { ThinkingLevel, Tuple } from './config.ts';

/**
 * Every type this module needs is derived from `compact()`'s own signature. That signature is one of
 * the three seams checked at activation, so deriving from it keeps the check and the call in step.
 */
type CompactArguments = Parameters<typeof compact>;
export type SummarizerModel = CompactArguments[1];
export type SummarizerStream = NonNullable<CompactArguments[7]>;
/** The host does not export this name; `compact()`'s first parameter is the same type. */
export type SummarizationPreparation = CompactArguments[0];
type StreamOptions = NonNullable<Parameters<SummarizerStream>[2]>;

const LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function resolveSummarizerModel(tuple: Tuple, ctx: ExtensionContext): SummarizerModel | undefined {
  if (tuple.model === null) return ctx.model;
  const separator = tuple.model.indexOf('/');
  return ctx.modelRegistry.find(tuple.model.slice(0, separator), tuple.model.slice(separator + 1));
}

/** The host's own clamping: prefer a higher supported level, then a lower one. */
export function clampThinkingLevel(model: SummarizerModel, level: ThinkingLevel): ThinkingLevel {
  const available = supportedThinkingLevels(model);
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

/**
 * The level the summarizer runs at.
 *
 * A model that does not support the requested level gets the host's own clamp, so a preset can never
 * produce a request the model rejects. A model whose `thinkingLevelMap` marks `off` unsupported
 * therefore reasons even when `off` was asked for, and the status view reports the level that was
 * actually used rather than the one that was requested.
 */
export function summarizerThinkingLevel(model: SummarizerModel, tuple: Tuple): ThinkingLevel {
  return clampThinkingLevel(model, tuple.thinking);
}

/** What the provider's own response said about a summarization attempt. */
export interface AttemptOutcome {
  /** The response's `stopReason`; undefined when the provider sent none we recognise. */
  stopReason?: string;
  /** Whether the response tried to call a tool instead of writing a summary. */
  toolCall: boolean;
}

/**
 * The stream function this package owns.
 *
 * It exists for two reasons and injects nothing. The registry's own `streamSimple` resolves
 * credentials for a summarizer on another provider, which `compact()`'s explicit api-key arguments
 * cannot do for us. And it is where the response is read: the host turns an error and a tool call
 * into thrown errors whose prose would otherwise have to be string-matched, and it returns a
 * partially written summary **unchanged** for any other stop reason — `aborted` being the case the
 * specification names. Refusing to persist one is this package's entire quality guarantee, so the
 * stop reason has to be read from the response rather than inferred.
 *
 * That read rests on a third host seam: the host awaits `result()` on whatever this function returns,
 * so the replacement installed below is the one it calls. Without it no outcome is recorded at all —
 * a silent, quality-only failure, which is why `checkHostSeam` probes for it.
 */
export function observingStream(
  registry: ModelRegistry,
  observe?: (group: object, outcome: AttemptOutcome) => void,
): SummarizerStream {
  return ((model: SummarizerModel, context: unknown, options?: StreamOptions) => {
    const stream = registry.streamSimple(model, context as never, options) as { result: () => Promise<unknown> };
    if (!observe) return stream;
    const result = stream.result.bind(stream);
    stream.result = async () => {
      const message = await result();
      // The group is the context this response came from, and it is what separates a retry from a
      // split turn. The host's retry policy calls the stream function again with the *same* context
      // after a transient failure, and only the response it finally returns is the one `compact()`
      // acts on — so a later response replaces an earlier one in that group, and a discarded failure
      // must not be read as the attempt's outcome. A split turn summarises two ranges through two
      // different contexts, and each of those has to be clean on its own.
      observe(context as object, outcomeOf(message));
      return message;
    };
    return stream;
  }) as unknown as SummarizerStream;
}

function outcomeOf(message: unknown): AttemptOutcome {
  const response = (message ?? {}) as { stopReason?: unknown; content?: unknown };
  const content = Array.isArray(response.content) ? response.content : [];
  return {
    ...(typeof response.stopReason === 'string' ? { stopReason: response.stopReason } : {}),
    toolCall: content.some((block) => (block as { type?: unknown } | null)?.type === 'toolCall'),
  };
}

export interface RetryPolicy {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxAgentDelayMs: number;
}

/**
 * The host's resolved retry policy for a summarization request.
 *
 * shortcut: this repeats `SettingsManager.getRetrySettings()` — the same four defaults over the raw
 * merged settings — because an extension is handed merged rather than resolved settings. Passing no
 * policy at all is worse than it looks: the host wraps every summarization call in
 * `retryAssistantCall()` precisely so a transient stream drop does not fail the compaction, and that
 * wrapper never retries without a policy. On a summary request that runs for minutes, a dropped
 * socket would then fail the whole compaction on the first attempt — strictly worse than the native
 * path it wraps. Read the resolved policy from the extension API when the host exposes one.
 */
export function hostRetryPolicy(settings: { retry?: Partial<RetryPolicy> }): RetryPolicy {
  return {
    enabled: settings.retry?.enabled ?? true,
    maxRetries: settings.retry?.maxRetries ?? 3,
    baseDelayMs: settings.retry?.baseDelayMs ?? 2_000,
    maxAgentDelayMs: settings.retry?.maxAgentDelayMs ?? 60_000,
  };
}

export interface SeamResult {
  ok: boolean;
  detail: string;
}

/**
 * Three things the host does are not documented extension APIs: `compact()`'s argument list, the
 * point at which it calls its stream function, and that it awaits `result()` on whatever that
 * function returns. All three are checked rather than assumed — with an actual call through a stream
 * function we supply, which needs no credentials and makes no request. A mismatch hands compaction
 * back to the host instead of letting the package misbehave.
 */
export async function checkHostSeam(compactFn: typeof compact = compact): Promise<SeamResult> {
  try {
    return await probeSeam(compactFn);
  } catch (error) {
    return { ok: false, detail: `the seam check itself failed: ${String(error)}` };
  }
}

async function probeSeam(compactFn: typeof compact): Promise<SeamResult> {
  if (compactFn.length !== 12) {
    return { ok: false, detail: `compact() takes ${compactFn.length} arguments, not 12` };
  }
  const seen: unknown[] = [];
  let awaited = 0;
  let produced = 0;
  const stream: SummarizerStream = ((_model: unknown, _context: unknown, options?: StreamOptions) => {
    seen.push(options);
    return {
      result: async () => {
        awaited += 1;
        produced += 1;
        // The first attempt fails retryably, so a retry policy that reached the host's own wrapper
        // shows up as a second call. Arity alone cannot prove the tenth argument is still the retry
        // policy: every argument this package passes after the stream function used to be `undefined`,
        // so a host that reordered them was harmless, and this is the first one where a wrong position
        // would silently misroute a value the package depends on.
        return produced === 1 ? probeErrorResponse() : probeResponse();
      },
    } as never;
  }) as unknown as SummarizerStream;
  const retry: RetryPolicy = { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 1 };
  try {
    await compactFn(
      probePreparation(), probeModel(), undefined, undefined, undefined, undefined, 'off', stream,
      undefined, retry, undefined, 'pi-compaction-seam-probe',
    );
  } catch (error) {
    return { ok: false, detail: `compact() rejected a supplied stream function: ${String(error)}` };
  }
  const options = seen[0];
  if (seen.length === 0 || !options || typeof options !== 'object') {
    return { ok: false, detail: `the supplied stream function was called ${seen.length} times with ${typeof options} options` };
  }
  // The third seam. Without it no outcome is ever observed, so a partial summary cannot be told from
  // a complete one and would be persisted.
  if (awaited === 0) {
    return {
      ok: false,
      detail: "compact() never awaited result() on the object our stream function returned, so a response's stopReason cannot be read",
    };
  }
  if (produced < 2) {
    return {
      ok: false,
      detail: 'compact() did not apply the retry policy passed in its tenth argument, so a host that '
        + 'reordered its parameters would go undetected and the policy would be misrouted',
    };
  }
  return {
    ok: true,
    detail: `compact() arity 12; our stream function received {${Object.keys(options).sort().join(', ')}}, `
      + `its result() was awaited, and the retry policy we passed drove a retry (${produced} attempts)`,
  };
}

/**
 * A retryable failure. The message has to match the host's retryable-error pattern, or the probe's
 * second call never happens and the retry-policy check would pass for the wrong reason.
 */
function probeErrorResponse() {
  return {
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage: 'server error',
    provider: 'pi-compaction-seam-probe',
    model: 'pi-compaction-seam-probe',
    timestamp: Date.now(),
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
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
