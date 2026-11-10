import { compact, DEFAULT_COMPACTION_SETTINGS } from '@earendil-works/pi-coding-agent';
import type { ExtensionContext, ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { ThinkingLevel, Tuple } from './config.ts';

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
 * Answer-budget adapters that add the thinking budget on top of the output option:
 * `adjustMaxTokensForThinking()` returns `min(maxTokens + thinkingBudget, model.maxTokens)`.
 */
const ADDS_THINKING_ON_TOP = new Set(['anthropic-messages', 'bedrock-converse-stream']);

/**
 * Answer-budget adapters that emit the output option and the thinking budget as two separate
 * fields. Whether the provider counts thinking against `maxOutputTokens` is provider behaviour this
 * package has not tested, so the resulting envelope is reported as provider-dependent.
 */
const SEPARATE_THINKING_FIELD = new Set(['google-generative-ai', 'google-vertex']);

/**
 * Adapters that send no output-ceiling field at all. `openai-codex-responses` builds a body of
 * `model`, `store`, `stream`, `instructions`, `input`, `text`, `include`, `prompt_cache_key`,
 * `tool_choice` and `parallel_tool_calls`, plus optional `temperature`, `service_tier`, `tools` and a
 * reasoning effort — and never reads `maxTokens`. A ceiling handed to it is silently dropped.
 */
const NO_CEILING_APIS = new Set(['openai-codex-responses']);

export type ApiClass = 'answer-budget' | 'single-pool' | 'no-ceiling';
/** Whether the reasoning budget reaches the provider as a token cap. */
export type ReasoningBudgetEffect = 'enforced' | 'advisory' | 'not sent' | 'not applied';

/**
 * Which of the three shapes the model's API has. An API this package has not read is treated as one
 * pool, which asks for a summed ceiling rather than only the text budget.
 */
export function apiClassOf(model: SummarizerModel): ApiClass {
  if (NO_CEILING_APIS.has(model.api)) return 'no-ceiling';
  if (ADDS_THINKING_ON_TOP.has(model.api) || SEPARATE_THINKING_FIELD.has(model.api)) return 'answer-budget';
  return 'single-pool';
}

/** The host estimates a compaction summary at four characters per token. */
export const estimateSummaryTokens = (summary: string): number => Math.ceil(summary.length / 4);

export interface OutputBudgets {
  maxTokens: number;
  thinkingBudgets?: { minimal: number; low: number; medium: number; high: number };
}

/**
 * The two budgets mapped onto whatever the model's adapter exposes. On an answer-budget API the
 * output option is the answer budget, so it carries the text budget and the reasoning budget goes
 * through the per-level thinking-budget option; everywhere else the output option is one pool and
 * carries their sum. The reasoning budget is absolute, so it is set for every level: an adapter that
 * clamps the requested level must not fall back to its own default budget.
 *
 * `keepPool` leaves a single pool at `textBudget + reasoningBudget` with thinking off, which is what
 * the ladder's single-pool retry asks for: the tighter configuration there is the reasoning draw,
 * not the envelope, and a smaller envelope would make a second length stop more likely.
 */
export function outputBudgets(
  model: SummarizerModel,
  tuple: Tuple,
  thinking: ThinkingLevel,
  options: { keepPool?: boolean } = {},
): OutputBudgets {
  const reasoning = thinking === 'off' ? 0 : tuple.reasoningBudget;
  const pool = options.keepPool ? tuple.textBudget + tuple.reasoningBudget : tuple.textBudget + reasoning;
  const budgets: OutputBudgets = {
    maxTokens: apiClassOf(model) === 'answer-budget' ? tuple.textBudget : pool,
  };
  if (reasoning > 0) {
    budgets.thinkingBudgets = { minimal: reasoning, low: reasoning, medium: reasoning, high: reasoning };
  }
  return budgets;
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

/** A zero reasoning budget means the summarizer does not reason, whatever level the preset names. */
export function summarizerThinkingLevel(model: SummarizerModel, tuple: Tuple): ThinkingLevel {
  return clampThinkingLevel(model, tuple.reasoningBudget === 0 ? 'off' : tuple.thinking);
}

export function resolveSummarizerModel(tuple: Tuple, ctx: ExtensionContext): SummarizerModel | undefined {
  if (tuple.model === null) return ctx.model;
  const separator = tuple.model.indexOf('/');
  return ctx.modelRegistry.find(tuple.model.slice(0, separator), tuple.model.slice(separator + 1));
}

/**
 * The host's prompt and tool declarations on the owner's profile. A constant this package cannot
 * reduce: it adds no tools of its own. It is what turns a worst-case summary into a worst-case base
 * context.
 */
export const HOST_PROMPT_AND_TOOLS_TOKENS = 34_874;

export interface OutboundRequest {
  api: string;
  apiClass: ApiClass;
  /** The value the provider's own output-ceiling field carries, or null when it sends none. */
  outputFieldCeiling: number | null;
  /** The model's own output limit, which caps an adapter that adds thinking on top. */
  modelLimit: number;
  reasoningTokens: number;
  reasoningBudget: ReasoningBudgetEffect;
  /** Whether at least `textBudget` of room is guaranteed to remain available for text. */
  textRoomGuaranteed: boolean;
  /** Whether the envelope depends on provider behaviour this package has not tested. */
  providerDependent: boolean;
  /** The largest summary text the request permits, or null when nothing bounds it. */
  worstCaseSummaryTokens: number | null;
  /** Host prompt and tools + worst-case summary + the configured kept-window target. */
  worstCaseBaseContextTokens: number | null;
}

/**
 * What the summarization request will actually carry, as opposed to what the two budgets say.
 *
 * shortcut: this repeats the adapters' own arithmetic instead of reading it from them, because
 * pi-ai exposes no way to ask what a request will carry. Each branch below mirrors one adapter:
 * `adjustMaxTokensForThinking()` adds the thinking budget to the answer budget and caps the result
 * at the model's output limit on `anthropic-messages` and `bedrock-converse-stream`, after which
 * `clampMaxTokensToContext()` may lower it again for a large input — so a ceiling reported here is
 * an upper bound; the Google adapters emit the output option and the thinking budget separately; a
 * single-pool adapter sends our value through unchanged. Replace this with pi-ai's own projection
 * when it exposes one, or with a captured request body per API.
 *
 * The worst case is the same on both enforceable classes: reasoning draws from the same allowance as
 * the text on every API this package supports, so a model that spends nothing on reasoning may spend
 * the whole pool on text. Only a preset whose reasoning budget is zero makes the text budget a hard
 * ceiling.
 */
export function describeOutboundRequest(
  model: SummarizerModel,
  tuple: Tuple,
  thinking: ThinkingLevel,
  keptWindowTokens: number,
): OutboundRequest {
  const reasoning = thinking === 'off' ? 0 : tuple.reasoningBudget;
  const apiClass = apiClassOf(model);
  const modelLimit = typeof model.maxTokens === 'number' && model.maxTokens > 0
    ? model.maxTokens
    : Number.POSITIVE_INFINITY;
  const pool = tuple.textBudget + reasoning;

  if (apiClass === 'no-ceiling') {
    return {
      api: model.api,
      apiClass,
      outputFieldCeiling: null,
      modelLimit,
      reasoningTokens: reasoning,
      reasoningBudget: 'not applied',
      textRoomGuaranteed: false,
      providerDependent: false,
      worstCaseSummaryTokens: null,
      worstCaseBaseContextTokens: null,
    };
  }

  const addsOnTop = ADDS_THINKING_ON_TOP.has(model.api);
  const separate = SEPARATE_THINKING_FIELD.has(model.api);
  const enforced = reasoning > 0 && reasoningBudgetReachesProvider(model, apiClass);
  const outputFieldCeiling = addsOnTop
    ? Math.min(pool, modelLimit)
    : separate
      ? tuple.textBudget
      : pool;
  const worstCaseSummaryTokens = addsOnTop ? outputFieldCeiling : pool;
  return {
    api: model.api,
    apiClass,
    outputFieldCeiling,
    modelLimit,
    reasoningTokens: reasoning,
    reasoningBudget: reasoning === 0 ? 'not sent' : enforced ? 'enforced' : 'advisory',
    // Thinking capped at the reasoning budget inside an envelope of their sum leaves the text budget
    // available; an uncapped reasoning phase in a shared pool does not, and a separate thinking field
    // depends on whether the provider counts it against the output option.
    textRoomGuaranteed: reasoning === 0 || (enforced && !separate),
    providerDependent: separate,
    worstCaseSummaryTokens,
    worstCaseBaseContextTokens: HOST_PROMPT_AND_TOOLS_TOKENS + worstCaseSummaryTokens + keptWindowTokens,
  };
}

/**
 * Every answer-budget adapter reads `thinkingBudgets`. Of the single-pool adapters only
 * `openai-completions` does, and only to fill a top-level thinking-token-budget field that the
 * model's compatibility settings declare (`compat.thinkingTokenBudgetField`, or
 * `compat.supportsThinkingTokenBudget` for the default `thinking_token_budget` name); it clamps the
 * budget to leave answer room against `max_tokens ?? max_completion_tokens ?? model.maxTokens`.
 * `openai-responses`, `azure-openai-responses` and `openai-codex-responses` never read it — there
 * reasoning is an effort level rather than a token cap.
 */
function reasoningBudgetReachesProvider(model: SummarizerModel, apiClass: ApiClass): boolean {
  if (apiClass === 'answer-budget') return true;
  if (model.api !== 'openai-completions') return false;
  const compat = (model as { compat?: { thinkingTokenBudgetField?: unknown; supportsThinkingTokenBudget?: unknown } }).compat;
  return Boolean(compat?.thinkingTokenBudgetField || compat?.supportsThinkingTokenBudget);
}

/** What the provider's own response said about a summarization attempt. */
export interface AttemptOutcome {
  /** The response's `stopReason`; undefined when the provider sent none we recognise. */
  stopReason?: string;
  /** Whether the response tried to call a tool instead of writing a summary. */
  toolCall: boolean;
}

/**
 * The injection point: the host hands its summarization request options straight through, with no
 * output ceiling of its own, and this is where the two budgets are added.
 *
 * `observe` reports what the response actually said. The host turns a length stop, an error and a
 * tool call into thrown errors whose prose would otherwise have to be string-matched to tell them
 * apart — and it returns a partially written summary unchanged when a response stops for any other
 * reason. We own this function, so we read the response instead.
 */
export function boundedStream(
  registry: ModelRegistry,
  budgets: OutputBudgets,
  observe?: (outcome: AttemptOutcome) => void,
): SummarizerStream {
  return ((model: SummarizerModel, context: unknown, options?: StreamOptions) => {
    const stream = registry.streamSimple(model, context as never, {
      ...options,
      maxTokens: budgets.maxTokens,
      ...(budgets.thinkingBudgets ? { thinkingBudgets: budgets.thinkingBudgets } : {}),
    }) as { result: () => Promise<unknown> };
    if (!observe) return stream;
    const result = stream.result.bind(stream);
    stream.result = async () => {
      const message = await result();
      observe(outcomeOf(message));
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
