import { appendFileSync } from 'node:fs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * In-process fake provider. `ProviderConfig` accepts a `streamSimple` handler together with a
 * custom `api` identifier, and the host routes a request to it when the model's `api` matches, so
 * no HTTP, no loopback, no separate process and no model account are involved.
 *
 * It records the options it is handed — that is where the budget assertions read from — and can
 * return a normal summary, a deliberately oversized one, or an error.
 *
 * `PI_COMPACTION_FIXTURE_RECORD`   file the recorded requests are appended to, as JSON lines
 * `PI_COMPACTION_FIXTURE_MODE`     normal (default) | oversized | error | length
 * `PI_COMPACTION_FIXTURE_SUMMARY`  summary size in host-estimated tokens (default 200)
 * `PI_COMPACTION_FIXTURE_WRITE`    path the conversation model asks `write` to create, once
 */

const ANSWER_BUDGET_API = 'anthropic-messages';
const POOL_API = 'openai-responses';
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
  contextWindow: 200_000,
  maxTokens: 64_000,
  ...extra,
});

export default function fakeProvider(pi: ExtensionAPI) {
  const record = process.env.PI_COMPACTION_FIXTURE_RECORD;
  const mode = process.env.PI_COMPACTION_FIXTURE_MODE ?? 'normal';
  const summaryTokens = Number(process.env.PI_COMPACTION_FIXTURE_SUMMARY ?? 200);
  const writePath = process.env.PI_COMPACTION_FIXTURE_WRITE;
  let conversationTurns = 0;

  const handler = (candidate: AnyModel, context: { messages?: Array<{ role: string; content?: unknown }> }, options?: AnyOptions) => {
    const system = [...(context.messages ?? [])].reverse().find((message) => message.role === 'system');
    const systemPrompt = typeof system?.content === 'string' ? system.content : '';
    const summarization = systemPrompt.startsWith(SUMMARIZATION_PROMPT_PREFIX);
    const turn = summarization ? 0 : ++conversationTurns;
    const entry = {
      model: `${candidate.provider}/${candidate.id}`,
      api: candidate.api,
      summarization,
      systemPrompt: systemPrompt.slice(0, 80),
      mode,
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
      return respond(candidate, { summarization, turn });
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
    const base = {
      role: 'assistant',
      provider: candidate.provider,
      model: candidate.id,
      timestamp: Date.now(),
      usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost },
    };
    if (mode === 'error') {
      return { ...base, content: [], stopReason: 'error', errorMessage: 'fixture summarizer is unavailable' };
    }
    if (mode === 'length') {
      return { ...base, content: [{ type: 'text', text: 'partial' }], stopReason: 'length' };
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
    const tokens = mode === 'oversized' ? summaryTokens * 10 : summaryTokens;
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
      model('pi-compaction-conversation', ANSWER_BUDGET_API),
    ] as never,
  });

  pi.registerProvider('pi-compaction-fixture-pool', {
    name: 'fixture openai-responses',
    baseUrl: 'http://127.0.0.1:1/fixture',
    apiKey: 'fixture',
    api: POOL_API,
    streamSimple: handler as never,
    models: [model('pool-summarizer', POOL_API)] as never,
  });
}

/** Four characters per token is the host's own estimator for a compaction summary. */
function summaryText(tokens: number): string {
  return `FIXTURE-SUMMARY ${'s'.repeat(Math.max(0, tokens * 4 - 'FIXTURE-SUMMARY '.length - 1))}\n`;
}

/** The text the request carries, which for a summarization request is the serialized conversation. */
function promptOf(context: { messages?: Array<{ role: string; content?: unknown }> }): string {
  return (context.messages ?? [])
    .filter((message) => message.role !== 'system')
    .map((message) => {
      const content = message.content;
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return '';
      return content.map((block) => (typeof block === 'object' && block && 'text' in block ? String((block as { text: unknown }).text) : '')).join('');
    })
    .join('\n');
}
