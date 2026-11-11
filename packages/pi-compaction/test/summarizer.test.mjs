import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compact } from '@earendil-works/pi-coding-agent';
import {
  checkHostSeam,
  clampThinkingLevel,
  hostRetryPolicy,
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

test('the retry policy is resolved the way the host resolves it', () => {
  // Without a policy the host's own `retryAssistantCall()` wrapper never retries, so a transient
  // stream drop on a minutes-long summary request fails the whole compaction on the first attempt.
  assert.deepEqual(hostRetryPolicy({}), {
    enabled: true, maxRetries: 3, baseDelayMs: 2_000, maxAgentDelayMs: 60_000,
  });
  assert.deepEqual(hostRetryPolicy({ retry: { enabled: false, maxRetries: 9 } }), {
    enabled: false, maxRetries: 9, baseDelayMs: 2_000, maxAgentDelayMs: 60_000,
  });
  assert.equal(hostRetryPolicy({ retry: { enabled: true } }).maxRetries, 3, 'one field does not zero the rest');
});

test('the host seam check accepts this package\'s host and reports what it saw', async () => {
  const result = await checkHostSeam();
  assert.equal(result.ok, true, result.detail);
  assert.match(result.detail, /arity 12/);
  assert.match(result.detail, /cacheRetention/);
  // The third seam: the host must await result() on what our stream function returns, or no
  // response is ever observed and a partial summary cannot be told from a complete one.
  assert.match(result.detail, /its result\(\) was awaited/);
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
