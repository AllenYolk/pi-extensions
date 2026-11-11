import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compact } from '@earendil-works/pi-coding-agent';
import {
  checkHostSeam,
  clampThinkingLevel,
  hostRetryPolicy,
  observingStream,
  summarizerThinkingLevel,
} from '../src/summarizer.ts';

const model = (api, extra = {}) => ({
  id: 'm', provider: 'p', name: 'm', api, reasoning: true, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000, maxTokens: 64_000, ...extra,
});

const tuple = (thinking) => ({ model: null, thinking });

test('an unsupported thinking level is clamped the way the host clamps it', () => {
  const noMedium = model('anthropic-messages', { thinkingLevelMap: { medium: null } });
  assert.equal(clampThinkingLevel(noMedium, 'medium'), 'high', 'a higher supported level wins');
  const onlyLow = model('anthropic-messages', { thinkingLevelMap: { medium: null, high: null, xhigh: null, max: null } });
  assert.equal(clampThinkingLevel(onlyLow, 'high'), 'low', 'then a lower one');
  assert.equal(clampThinkingLevel(model('anthropic-messages', { reasoning: false }), 'high'), 'off');
  const noExtended = model('anthropic-messages');
  assert.equal(clampThinkingLevel(noExtended, 'xhigh'), 'high', 'an unmapped extended level falls back to the highest mapped one');
  assert.equal(clampThinkingLevel(noExtended, 'medium'), 'medium');
});

test('the configured level reaches the summarizer when the model supports it', () => {
  for (const level of ['off', 'minimal', 'low', 'medium', 'high']) {
    assert.equal(summarizerThinkingLevel(model('anthropic-messages'), tuple(level)), level, level);
  }
});

test('a model with no off cannot be told not to reason', () => {
  // The shape of a reasoning model that has no way to turn thinking off — the owner's own
  // conversation model among them. The level that was asked for is not the level that runs, and the
  // status view reports the one that runs.
  const noOff = model('openai-responses', {
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high' },
  });
  assert.equal(summarizerThinkingLevel(noOff, tuple('off')), 'low');
  assert.equal(summarizerThinkingLevel(noOff, tuple('minimal')), 'low');
  assert.equal(summarizerThinkingLevel(noOff, tuple('medium')), 'medium', 'a supported level is untouched');

  // A model that does have an off really does stop.
  const withOff = model('openai-responses', { thinkingLevelMap: { off: 'none', low: 'low' } });
  assert.equal(summarizerThinkingLevel(withOff, tuple('off')), 'off');

  // And a model with nothing at all still gets the lowest level it has rather than a rejected one.
  const high = model('openai-responses', {
    thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: 'high' },
  });
  assert.equal(summarizerThinkingLevel(high, tuple('off')), 'high');
});

test('the retry policy defaults match the host\'s own, and a user setting wins', () => {
  // Without a policy the host's own `retryAssistantCall()` wrapper never retries, so a transient
  // stream drop on a minutes-long summary request fails the whole compaction on the first attempt.
  // `hostRetryPolicy` repeats `SettingsManager.getRetrySettings()`'s four defaults because an
  // extension is handed merged rather than resolved settings — so the defaults are checked against
  // the host's, read from its own source, rather than against constants this test invented. A host
  // that changed them would otherwise leave this package sending a wrong policy that still passed.
  // Resolved the way `pi-host.mjs` resolves it: the host this package's own workspace resolves, not a
  // fixed `./node_modules` path that a different Pi version could occupy after hoisting.
  const hostDir = dirname(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))));
  const hostSource = readFileSync(join(hostDir, 'dist/core/settings-defaults.js'), 'utf8');
  const hostDefaults = hostSource.slice(hostSource.indexOf('retry: {'));
  const numberAfter = (key) => Number(/(\d[\d_]*)/.exec(hostDefaults.slice(hostDefaults.indexOf(key)))[1].replace(/_/g, ''));

  const ours = hostRetryPolicy({});
  assert.equal(ours.enabled, /retry:\s*\{[\s\S]*?enabled:\s*true/.test(hostSource), 'enabled');
  assert.equal(ours.maxRetries, numberAfter('maxRetries:'), 'maxRetries');
  assert.equal(ours.baseDelayMs, numberAfter('baseDelayMs:'), 'baseDelayMs');
  assert.match(hostDefaults, /maxAgentDelayMs:\s*DEFAULT_MAX_AGENT_RETRY_DELAY_MS/, 'the host names its max delay');

  // And a user setting still wins over every default.
  assert.deepEqual(hostRetryPolicy({ retry: { enabled: false, maxRetries: 9, baseDelayMs: 5 } }), {
    enabled: false, maxRetries: 9, baseDelayMs: 5, maxAgentDelayMs: ours.maxAgentDelayMs,
  });
  assert.equal(hostRetryPolicy({ retry: { enabled: true } }).maxRetries, ours.maxRetries, 'one field does not zero the rest');
});

test('a response that was retried away does not fail the attempt', async () => {
  // The host's retry policy calls the stream function again with the *same* context after a transient
  // failure, and only the response it finally returns is the one `compact()` acted on. Reading the
  // discarded failure as this attempt's outcome would hand compaction back to stock Pi after a
  // summary that succeeded.
  const responses = [
    { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'server error' },
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' },
  ];
  let call = 0;
  const registry = { streamSimple: () => ({ result: async () => responses[Math.min(call++, 1)] }) };
  const groups = new Map();
  const stream = observingStream(registry, (group, outcome) => { groups.set(group, outcome); });

  const context = { messages: [] };
  for (let attempt = 0; attempt < 2; attempt++) {
    await stream(model('anthropic-messages'), context, {}).result();
  }
  assert.equal(groups.size, 1, 'one context is one group, however many times it was retried');
  assert.equal([...groups.values()][0].stopReason, 'stop', 'the retried-away error is not the outcome');
});

test('a split turn keeps one response per range, and both are checked', async () => {
  // The host summarises a split turn's two ranges through two contexts and concatenates both into one
  // summary, so a clean second response says nothing about a partial first one.
  const responses = [
    { role: 'assistant', content: [{ type: 'text', text: 'history' }], stopReason: 'aborted' },
    { role: 'assistant', content: [{ type: 'text', text: 'prefix' }], stopReason: 'stop' },
  ];
  let call = 0;
  const registry = { streamSimple: () => ({ result: async () => responses[call++] }) };
  const groups = new Map();
  const stream = observingStream(registry, (group, outcome) => { groups.set(group, outcome); });

  for (const context of [{ messages: ['history'] }, { messages: ['prefix'] }]) {
    await stream(model('anthropic-messages'), context, {}).result();
  }
  assert.equal(groups.size, 2, 'two ranges are two groups');
  const seen = [...groups.values()].map((outcome) => outcome.stopReason);
  assert.deepEqual(seen, ['aborted', 'stop'], 'the partial first response survives as its own group');
});

test('the host seam check accepts this package\'s host and reports what it saw', async () => {
  const result = await checkHostSeam();
  assert.equal(result.ok, true, result.detail);
  assert.match(result.detail, /arity 12/);
  assert.match(result.detail, /cacheRetention/);
  // The third seam: the host must await result() on what our stream function returns, or no
  // response is ever observed and a partial summary cannot be told from a complete one.
  assert.match(result.detail, /its result\(\) was awaited/);
  // The tenth argument: arity proves the count of parameters and nothing about their order. Every
  // argument after the stream function used to be `undefined`, so a reorder was harmless; the retry
  // policy is the first one where a wrong slot would silently misroute a value the package depends on.
  assert.match(result.detail, /the retry policy we passed drove a retry \(2 attempts\)/);
});

test('the host seam check rejects a host that ignores the retry policy slot', async () => {
  // Right arity, the stream function is called, and its result() is awaited — the first three checks
  // all pass. But the host never applies the policy in the tenth argument, which is exactly what a
  // reordered parameter list would look like from here.
  const ignoresRetry = async (
    _preparation, _model, _apiKey, _headers, _instructions, _signal, _thinking, streamFn,
  ) => {
    const stream = await streamFn(undefined, undefined, {});
    await stream.result();
    return { summary: 'x', firstKeptEntryId: 'x', tokensBefore: 0 };
  };
  Object.defineProperty(ignoresRetry, 'length', { value: 12 });
  const result = await checkHostSeam(ignoresRetry);
  assert.equal(result.ok, false);
  assert.match(result.detail, /did not apply the retry policy passed in its tenth argument/);
});

test('the host seam check steps aside on a compaction function with another shape', async () => {
  const shorter = (...args) => compact(...args);
  Object.defineProperty(shorter, 'length', { value: 9 });
  const result = await checkHostSeam(shorter);
  assert.equal(result.ok, false);
  assert.match(result.detail, /takes 9 arguments, not 12/);

  const ignoresStream = async () => ({ summary: 'x', firstKeptEntryId: 'x', tokensBefore: 0 });
  Object.defineProperty(ignoresStream, 'length', { value: 12 });
  const ignored = await checkHostSeam(ignoresStream);
  assert.equal(ignored.ok, false);
  assert.match(ignored.detail, /called 0 times/);
});

test('the host seam check rejects a host that never resolves the stream it was handed', async () => {
  // The right arity and the stream function is called with options, so the first two seams hold —
  // but the host drops the object instead of awaiting its result(), so this package would never
  // observe a stopReason and would persist whatever summary came back.
  const ignoresResult = async (
    _preparation, _model, _apiKey, _headers, _instructions, _signal, _thinking, streamFn,
  ) => {
    await streamFn(undefined, undefined, {});
    return { summary: 'x', firstKeptEntryId: 'x', tokensBefore: 0 };
  };
  Object.defineProperty(ignoresResult, 'length', { value: 12 });
  const result = await checkHostSeam(ignoresResult);
  assert.equal(result.ok, false);
  assert.match(result.detail, /never awaited result\(\)/);
});
