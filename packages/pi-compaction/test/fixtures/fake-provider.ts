import { appendFileSync } from 'node:fs';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

/**
 * In-process fake provider. `ProviderConfig` accepts a `streamSimple` handler together with a
 * custom `api` identifier, and the host routes a request to it when the model's `api` matches, so
 * no HTTP, no loopback, no separate process and no model account are involved.
 *
 * It records the options it is handed — that is where the budget assertions read from — and can
 * return a normal summary, a deliberately oversized one, an error or a length stop.
 *
 * `PI_COMPACTION_FIXTURE_RECORD`   file the recorded requests are appended to, as JSON lines
 * `PI_COMPACTION_FIXTURE_MODE`     normal (default) | oversized | error | length
 * `PI_COMPACTION_FIXTURE_STOP_REASON`  stop reason a failing summarization response carries instead
 *                                      of MODE's; the host returns anything but `error` and `length`
 *                                      as a normal result carrying partial text, which is the only
 *                                      way the package's own refusal is reached
 * `PI_COMPACTION_FIXTURE_FAIL_FIRST`  how many leading summarization requests take `MODE`; unset is
 *                                      every one of them, so a mode is only left behind on request
 * `PI_COMPACTION_FIXTURE_SUMMARY`  summary size in host-estimated tokens (default 200)
 * `PI_COMPACTION_FIXTURE_WRITE`    path the conversation model asks `write` to create, once
 * `PI_COMPACTION_FIXTURE_CACHE_READ`   cacheRead the conversation response reports (default 0)
 * `PI_COMPACTION_FIXTURE_CACHE_WRITE`  cacheWrite the conversation response reports (default 0)
 * `PI_COMPACTION_FIXTURE_NO_USAGE`     report no usable usage at all, which is what a provider
 *                                      that does not account for tokens looks like to the host
 * `PI_COMPACTION_FIXTURE_TOTAL_TOKENS` totalTokens the conversation response reports, which is what
 *                                     the host's context accounting reads when it is present
 * `PI_COMPACTION_FIXTURE_CONTEXT_WINDOW` the models' context window (default 200000)
 * `PI_COMPACTION_FIXTURE_MESSAGE_AGE_MS` backdates the conversation response's timestamp
 * `PI_COMPACTION_FIXTURE_ABORT_AFTER_SUMMARIZE` aborts the compaction once that summarization
 *                                     response has been produced, which is what a user pressing
 *                                     Escape mid-compaction does
 */

/** The text a length stop carries. The budget cut it, so it is persisted — see ADR 0004. */
const TRUNCATED_TEXT = 'TRUNCATED-AT-THE-CEILING';
/** The text an aborted response carries. It must never reach a persisted summary from any path. */
const PARTIAL_TEXT = 'PARTIAL-SUMMARY-MUST-NEVER-BE-PERSISTED';

const ANSWER_BUDGET_API = 'anthropic-messages';
const POOL_API = 'openai-responses';
const NO_CEILING_API = 'openai-codex-responses';
const SUMMARIZATION_PROMPT_PREFIX = 'You are a context summarization assistant.';

type AnyModel = { id: string; provider: string; api: string };
type AnyOptions = {
  maxTokens?: number;
  reasoning?: string;
  thinkingBudgets?: Record<string, number>;
  cacheRetention?: string;
  sessionId?: string;
  apiKey?: string;
  headers?: Record<string, unknown>;
  env?: Record<string, unknown>;
  signal?: AbortSignal;
  onPayload?: (payload: unknown, model: unknown) => unknown;
  onResponse?: (response: { status: number; headers: Record<string, string> }, model: unknown) => unknown;
};

const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const model = (id: string, api: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  api,
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: Number(process.env.PI_COMPACTION_FIXTURE_CONTEXT_WINDOW ?? 200_000),
  maxTokens: 64_000,
  ...extra,
});

export default function fakeProvider(pi: ExtensionAPI) {
  const record = process.env.PI_COMPACTION_FIXTURE_RECORD;
  const mode = process.env.PI_COMPACTION_FIXTURE_MODE ?? 'normal';
  const stopReason = process.env.PI_COMPACTION_FIXTURE_STOP_REASON;
  const failFirst = Number(process.env.PI_COMPACTION_FIXTURE_FAIL_FIRST ?? Number.MAX_SAFE_INTEGER);
  const abortAfter = Number(process.env.PI_COMPACTION_FIXTURE_ABORT_AFTER_SUMMARIZE ?? 0);
  const summaryTokens = Number(process.env.PI_COMPACTION_FIXTURE_SUMMARY ?? 200);
  const writePath = process.env.PI_COMPACTION_FIXTURE_WRITE;
  const cacheRead = Number(process.env.PI_COMPACTION_FIXTURE_CACHE_READ ?? 0);
  const cacheWrite = Number(process.env.PI_COMPACTION_FIXTURE_CACHE_WRITE ?? 0);
  const noUsage = Boolean(process.env.PI_COMPACTION_FIXTURE_NO_USAGE);
  const totalTokens = process.env.PI_COMPACTION_FIXTURE_TOTAL_TOKENS;
  const messageAgeMs = Number(process.env.PI_COMPACTION_FIXTURE_MESSAGE_AGE_MS ?? 0);
  let conversationTurns = 0;
  let summarizationTurns = 0;
  // The compaction's own context, captured so a response can abort the compaction the way a user
  // pressing Escape does. This handler is registered before the package's and returns nothing.
  let compactionCtx: ExtensionContext | undefined;
  pi.on('session_before_compact', (_event, ctx) => {
    compactionCtx = ctx;
  });

  const handler = (candidate: AnyModel, context: { messages?: Array<{ role: string; content?: unknown }> }, options?: AnyOptions) => {
    const system = [...(context.messages ?? [])].reverse().find((message) => message.role === 'system');
    const systemPrompt = typeof system?.content === 'string' ? system.content : '';
    const summarization = systemPrompt.startsWith(SUMMARIZATION_PROMPT_PREFIX);
    const turn = summarization ? ++summarizationTurns : ++conversationTurns;
    const failing = summarization && turn <= failFirst;
    const entry = {
      model: `${candidate.provider}/${candidate.id}`,
      api: candidate.api,
      summarization,
      systemPrompt: systemPrompt.slice(0, 80),
      mode: failing ? mode : 'normal',
      stopReason: failing ? stopReason : undefined,
      options: {
        maxTokens: options?.maxTokens,
        reasoning: options?.reasoning,
        thinkingBudgets: options?.thinkingBudgets,
        cacheRetention: options?.cacheRetention,
        sessionId: options?.sessionId,
        hasApiKey: typeof options?.apiKey === 'string',
        headerKeys: Object.keys(options?.headers ?? {}).sort(),
        envKeys: Object.keys(options?.env ?? {}).sort(),
      },
      honours: { onPayload: typeof options?.onPayload === 'function', onResponse: typeof options?.onResponse === 'function' },
    };

    // The host forwards whatever a streamSimple returns through `for await`, so the handler has to
    // return an async-iterable stream, not just a result.
    let built: Promise<Record<string, unknown>> | undefined;
    const produce = () => (built ??= (async () => {
      // A streamSimple implementation must invoke onPayload before sending and onResponse after
      // receiving, matching the built-in providers. Both are absent when compact() is called
      // directly with our own stream function, so they are honoured rather than required.
      const payload = { model: candidate.id, summarization };
      const replaced = await options?.onPayload?.(payload, candidate);
      await options?.onResponse?.({ status: 200, headers: {} }, candidate);
      const sent = replaced ?? payload;
      if (record) {
        appendFileSync(record, `${JSON.stringify({ ...entry, sent, prompt: promptOf(context) })}\n`);
      }
      const message = respond(candidate, { summarization, turn });
      if (summarization && turn === abortAfter) compactionCtx?.abort();
      return message;
    })());

    return {
      async *[Symbol.asyncIterator]() {
        const message = await produce();
        yield message.stopReason === 'error'
          ? { type: 'error', reason: 'error', error: message }
          : { type: 'done', message };
      },
      result: produce,
    };
  };

  function respond(candidate: AnyModel, { summarization, turn }: { summarization: boolean; turn: number }) {
    const failing = summarization && turn <= failFirst;
    const reported = summarization || noUsage ? { cacheRead: 0, cacheWrite: 0 } : { cacheRead, cacheWrite };
    const base = {
      role: 'assistant',
      provider: candidate.provider,
      model: candidate.id,
      timestamp: Date.now() - (summarization ? 0 : messageAgeMs),
      usage: {
        // A response with no tokens at all is one the host's own rule treats as having measured
        // nothing, which is what "usage is unavailable" looks like to the host.
        input: noUsage && !summarization ? 0 : 10,
        output: noUsage && !summarization ? 0 : 20,
        ...reported,
        cost,
        ...(totalTokens !== undefined && !summarization && !noUsage ? { totalTokens: Number(totalTokens) } : {}),
      },
    };
    if (failing && stopReason) {
      // A stop reason the host does not reject: it hands the partial text back as a normal result,
      // so only the package's own reading of the response refuses it.
      return { ...base, content: [{ type: 'text', text: PARTIAL_TEXT }], stopReason };
    }
    if (failing && mode === 'error') {
      return { ...base, content: [], stopReason: 'error', errorMessage: 'fixture summarizer is unavailable' };
    }
    if (failing && mode === 'length') {
      return { ...base, content: [{ type: 'text', text: TRUNCATED_TEXT }], stopReason: 'length' };
    }
    if (!summarization && writePath && turn === 1) {
      return {
        ...base,
        content: [{ type: 'toolCall', id: 'fixture-write', name: 'write', arguments: { path: writePath, content: 'fixture\n' } }],
        stopReason: 'toolUse',
      };
    }
    if (!summarization) {
      return { ...base, content: [{ type: 'text', text: 'fixture reply' }], stopReason: 'stop' };
    }
    const tokens = failing && mode === 'oversized' ? summaryTokens * 10 : summaryTokens;
    return { ...base, content: [{ type: 'text', text: summaryText(tokens) }], stopReason: 'stop' };
  }

  pi.registerProvider('minimax-cn', {
    name: 'fixture anthropic-messages',
    baseUrl: 'http://127.0.0.1:1/fixture',
    apiKey: 'fixture',
    api: ANSWER_BUDGET_API,
    streamSimple: handler as never,
    models: [
      model('minimax-M3.1-Flash', ANSWER_BUDGET_API),
      // `medium` is unsupported here, so a preset asking for it has to be clamped.
      model('minimax-M3.1-Flash-no-medium', ANSWER_BUDGET_API, { thinkingLevelMap: { medium: null } }),
      // Neither `off` nor `minimal` is supported, which is the shape a reasoning model that cannot
      // be told not to reason has — `mafia-o/gpt-6.1-sol` among them.
      model('pi-compaction-no-off', ANSWER_BUDGET_API, {
        thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high' },
      }),
      model('pi-compaction-conversation', ANSWER_BUDGET_API),
    ] as never,
  });

  pi.registerProvider('pi-compaction-fixture-pool', {
    name: 'fixture openai-responses',
    baseUrl: 'http://127.0.0.1:1/fixture',
    apiKey: 'fixture',
    api: POOL_API,
    streamSimple: handler as never,
    models: [
      model('pool-summarizer', POOL_API),
      // Same pool, but its compatibility settings declare a thinking-token-budget field, which is
      // the only case in which openai-completions sends a reasoning cap.
      model('pool-summarizer-budgeted', POOL_API, { api: 'openai-completions', compat: { supportsThinkingTokenBudget: true } }),
    ] as never,
  });

  // No `apiKey`, so the host reports this provider as having no configured credentials. It exists
  // to reach the handback that a signed-out summarizer takes.
  pi.registerProvider('pi-compaction-fixture-noauth', {
    name: 'fixture provider with no credentials',
    baseUrl: 'http://127.0.0.1:1/fixture',
    api: ANSWER_BUDGET_API,
    streamSimple: handler as never,
    models: [model('unauthenticated-summarizer', ANSWER_BUDGET_API)] as never,
  });

  pi.registerProvider('pi-compaction-fixture-codex', {
    name: 'fixture openai-codex-responses',
    baseUrl: 'http://127.0.0.1:1/fixture',
    apiKey: 'fixture',
    api: NO_CEILING_API,
    streamSimple: handler as never,
    models: [model('codex-summarizer', NO_CEILING_API)] as never,
  });
}

/** Four characters per token is the host's own estimator for a compaction summary. */
function summaryText(tokens: number): string {
  return `FIXTURE-SUMMARY ${'s'.repeat(Math.max(0, tokens * 4 - 'FIXTURE-SUMMARY '.length - 1))}\n`;
}

/**
 * The text the request carries, which for a summarization request is the serialized conversation.
 * Tool calls are included, so a caller can prove that a cut point put a turn's originating call and
 * its arguments on the summarised side rather than the kept side.
 */
function promptOf(context: { messages?: Array<{ role: string; content?: unknown }> }): string {
  return (context.messages ?? [])
    .filter((message) => message.role !== 'system')
    .map((message) => {
      const content = message.content;
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return '';
      return content
        .map((block) => {
          if (typeof block !== 'object' || block === null) return '';
          const record = block as Record<string, unknown>;
          if (record.type === 'toolCall') {
            return `TOOLCALL ${String(record.name)} ${String(record.id)} ${JSON.stringify(record.arguments)}`;
          }
          return 'text' in record ? String(record.text) : '';
        })
        .join('');
    })
    .join('\n');
}
