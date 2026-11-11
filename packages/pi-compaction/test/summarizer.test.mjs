import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compact } from '@earendil-works/pi-coding-agent';
import {
  acceptedTokens,
  apiClassOf,
  checkHostSeam,
  clampThinkingLevel,
  describeOutboundRequest,
  estimateModelTokens,
  estimateSummaryTokens,
  hostRetryPolicy,
  HOST_PROMPT_AND_TOOLS_TOKENS,
  outputBudgets,
  summarizerThinkingLevel,
} from '../src/summarizer.ts';
import { PRESETS } from '../src/config.ts';

/** The kept window the owner's measurements were taken at; the status view uses the configured one. */
const MEASURED_KEPT_WINDOW = 15_340;

const model = (api, extra = {}) => ({
  id: 'm', provider: 'p', name: 'm', api, reasoning: true, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000, maxTokens: 64_000, ...extra,
});

const balanced = PRESETS.balanced;
const thinkingOf = (tuple) => (tuple.reasoningBudget === 0 ? 'off' : tuple.thinking);

test('the three API classes are recognised', () => {
  for (const api of ['anthropic-messages', 'bedrock-converse-stream', 'google-generative-ai', 'google-vertex']) {
    assert.equal(apiClassOf(model(api)), 'answer-budget', api);
  }
  for (const api of ['openai-responses', 'azure-openai-responses', 'openai-completions', 'mistral-conversations', 'pi-messages', 'some-future-api']) {
    assert.equal(apiClassOf(model(api)), 'single-pool', api);
  }
  assert.equal(apiClassOf(model('openai-codex-responses')), 'no-ceiling');
});

test('an answer-budget API gets the text budget as its output option and the reasoning budget on top', () => {
  for (const api of ['anthropic-messages', 'bedrock-converse-stream', 'google-generative-ai', 'google-vertex']) {
    const budgets = outputBudgets(model(api), balanced, 'medium');
    assert.equal(budgets.maxTokens, balanced.textBudget, api);
    assert.deepEqual(budgets.thinkingBudgets, { minimal: 8_000, low: 8_000, medium: 8_000, high: 8_000 }, api);
    assert.equal(budgets.maxTokens + budgets.thinkingBudgets.medium, 20_000, api);
  }
});

test('a single-pool API gets both budgets as one output option', () => {
  for (const api of ['openai-responses', 'openai-completions', 'mistral-conversations', 'some-future-api']) {
    const budgets = outputBudgets(model(api), balanced, 'medium');
    assert.equal(budgets.maxTokens, 20_000, api);
  }
});

test('the reasoning budget is absolute, so a clamped level still gets it', () => {
  const budgets = outputBudgets(model('anthropic-messages'), balanced, 'high');
  assert.equal(budgets.thinkingBudgets.high, 8_000);
  assert.equal(budgets.thinkingBudgets.medium, 8_000, 'every level carries the same absolute budget');
});

test('thinking off sends no thinking budget and leaves the text budget as the whole pool', () => {
  for (const api of ['anthropic-messages', 'openai-responses']) {
    const budgets = outputBudgets(model(api), PRESETS.fast, 'off');
    assert.equal(budgets.maxTokens, 6_000, api);
    assert.equal(budgets.thinkingBudgets, undefined, api);
  }
});

test('a zero reasoning budget turns the summarizer\'s thinking off', () => {
  const tuple = { model: null, thinking: 'high', textBudget: 6_000, reasoningBudget: 0 };
  assert.equal(summarizerThinkingLevel(model('anthropic-messages'), tuple), 'off');
  assert.equal(summarizerThinkingLevel(model('anthropic-messages'), PRESETS.fast), 'off');
  assert.equal(summarizerThinkingLevel(model('anthropic-messages'), balanced), 'medium');
});

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

test('an answer-budget adapter adds the thinking budget to the output field and caps it at the model limit', () => {
  const outbound = describeOutboundRequest(model('anthropic-messages'), balanced, 'medium', 16_000);
  assert.equal(outbound.apiClass, 'answer-budget');
  assert.equal(outbound.outputFieldCeiling, 20_000, 'max_tokens carries text budget + reasoning budget');
  assert.equal(outbound.modelLimit, 64_000);
  assert.equal(outbound.reasoningBudget, 'enforced');
  assert.equal(outbound.textRoomGuaranteed, true, 'thinking capped at the reasoning budget leaves the text budget available');
  assert.equal(outbound.providerDependent, false);
  assert.equal(outbound.worstCaseSummaryTokens, 20_000);

  const capped = describeOutboundRequest(model('anthropic-messages', { maxTokens: 15_000 }), balanced, 'medium', 16_000);
  assert.equal(capped.outputFieldCeiling, 15_000, 'the model\'s own output limit caps the envelope');
  assert.equal(capped.worstCaseSummaryTokens, 15_000);
});

test('a single-pool adapter ignores the reasoning budget and leaves the text without its own ceiling', () => {
  for (const api of ['openai-responses', 'azure-openai-responses']) {
    const outbound = describeOutboundRequest(model(api), balanced, 'medium', 16_000);
    assert.equal(outbound.apiClass, 'single-pool', api);
    assert.equal(outbound.outputFieldCeiling, 20_000, api);
    assert.equal(outbound.reasoningBudget, 'advisory', `${api} sends an effort level, not a token cap`);
    assert.equal(outbound.textRoomGuaranteed, false, api);
    assert.equal(outbound.worstCaseSummaryTokens, 20_000, api);
  }
});

test('openai-completions enforces the reasoning budget only when its compat declares a field for it', () => {
  const declared = describeOutboundRequest(
    model('openai-completions', { compat: { supportsThinkingTokenBudget: true } }), balanced, 'medium', 16_000,
  );
  assert.equal(declared.apiClass, 'single-pool');
  assert.equal(declared.outputFieldCeiling, 20_000);
  assert.equal(declared.reasoningBudget, 'enforced');
  assert.equal(declared.textRoomGuaranteed, true);

  const named = describeOutboundRequest(
    model('openai-completions', { compat: { thinkingTokenBudgetField: 'thinking_token_budget' } }), balanced, 'medium', 16_000,
  );
  assert.equal(named.reasoningBudget, 'enforced');

  const undeclared = describeOutboundRequest(model('openai-completions'), balanced, 'medium', 16_000);
  assert.equal(undeclared.reasoningBudget, 'advisory');
  assert.equal(undeclared.textRoomGuaranteed, false);
});

test('an adapter that sends no output-ceiling field is reported as unenforceable', () => {
  const outbound = describeOutboundRequest(model('openai-codex-responses'), balanced, 'medium', 16_000);
  assert.equal(outbound.apiClass, 'no-ceiling');
  assert.equal(outbound.outputFieldCeiling, null);
  assert.equal(outbound.reasoningBudget, 'not applied');
  assert.equal(outbound.textRoomGuaranteed, false);
  assert.equal(outbound.worstCaseSummaryTokens, null);
  assert.equal(outbound.worstCaseBaseContextTokens, null);
});

test('the Google adapters are reported as provider-dependent', () => {
  for (const api of ['google-generative-ai', 'google-vertex']) {
    const outbound = describeOutboundRequest(model(api), balanced, 'medium', 16_000);
    assert.equal(outbound.apiClass, 'answer-budget', api);
    assert.equal(outbound.outputFieldCeiling, 12_000, `${api} emits the text budget as maxOutputTokens`);
    assert.equal(outbound.reasoningBudget, 'enforced', api);
    assert.equal(outbound.providerDependent, true, api);
    assert.equal(outbound.textRoomGuaranteed, false, 'whether thinking counts against maxOutputTokens is untested');
    assert.equal(outbound.worstCaseSummaryTokens, 20_000, 'the upper bound if it does not');
  }
});

test('the published per-preset numbers hold on both enforceable classes', () => {
  // pool / worst-case text / base context / whether the text budget is a hard ceiling
  const expected = {
    fast: { pool: 6_000, base: 56_214, hard: true },
    balanced: { pool: 20_000, base: 70_214, hard: false },
    deep: { pool: 36_000, base: 86_214, hard: false },
  };
  for (const [name, tuple] of Object.entries(PRESETS)) {
    const { pool, base, hard } = expected[name];
    for (const api of ['anthropic-messages', 'openai-responses']) {
      const outbound = describeOutboundRequest(model(api), tuple, thinkingOf(tuple), MEASURED_KEPT_WINDOW);
      assert.equal(outbound.outputFieldCeiling, pool, `${name} on ${api}`);
      assert.equal(outbound.worstCaseSummaryTokens, pool, `${name} on ${api}`);
      assert.equal(outbound.worstCaseBaseContextTokens, base, `${name} on ${api}`);
      assert.equal(outbound.worstCaseSummaryTokens === tuple.textBudget, hard, `${name} on ${api}: hard text ceiling`);
    }
    // Only `fast` keeps the text budget as a true ceiling, because its reasoning budget is zero.
    assert.equal(tuple.reasoningBudget === 0, hard, name);
  }
  assert.equal(HOST_PROMPT_AND_TOOLS_TOKENS + 6_000 + MEASURED_KEPT_WINDOW, 56_214);
});

test('a summary is measured with the host\'s own four-characters-per-token estimate', () => {
  assert.equal(estimateSummaryTokens(''), 0);
  assert.equal(estimateSummaryTokens('abcd'), 1);
  assert.equal(estimateSummaryTokens('a'.repeat(48_000)), 12_000);
});

test('a zero reasoning budget does not mean the summarizer will not reason', () => {
  // A zero budget asks for `off`. A model whose `thinkingLevelMap` marks `off` unsupported gets its
  // lowest level instead and then reasons anyway, drawing from the same envelope as the text with no
  // budget of its own. Saying "the summarizer does not reason" would be false, and so would promising
  // the text any room.
  const noOff = model('openai-responses', {
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high' },
  });
  assert.equal(summarizerThinkingLevel(noOff, PRESETS.fast), 'low', 'off is unavailable, so the lowest level wins');

  const outbound = describeOutboundRequest(noOff, PRESETS.fast, 'low', 16_000);
  assert.equal(outbound.reasoningBudget, 'uncapped');
  assert.equal(outbound.textRoomGuaranteed, false, 'the text has no guaranteed room');
  assert.equal(outbound.reasoningTokens, 0, 'no budget is sent');
  // The envelope is still the whole pool, so the worst case for the summary is unchanged.
  assert.equal(outbound.worstCaseSummaryTokens, 6_000);

  // A model that does have `off` really does not reason.
  const withOff = model('openai-responses', { thinkingLevelMap: { off: 'none', low: 'low' } });
  assert.equal(summarizerThinkingLevel(withOff, PRESETS.fast), 'off');
  const quiet = describeOutboundRequest(withOff, PRESETS.fast, 'off', 16_000);
  assert.equal(quiet.reasoningBudget, 'not sent');
  assert.equal(quiet.textRoomGuaranteed, true, 'the text has the whole pool');
});

test('an adapter whose output-ceiling flag is switched off is treated as sending no ceiling', () => {
  // `openai-responses` writes `max_output_tokens` only while `compat.supportsMaxOutputTokens` is not
  // false. A model that switches it off drops the ceiling silently, which is the exact failure this
  // package exists to prevent, so it is read rather than assumed.
  const off = model('openai-responses', { compat: { supportsMaxOutputTokens: false } });
  assert.equal(apiClassOf(off), 'no-ceiling');
  const outbound = describeOutboundRequest(off, balanced, 'medium', 16_000);
  assert.equal(outbound.outputFieldCeiling, null);
  assert.equal(outbound.ceilingFlag, 'supportsMaxOutputTokens', 'the status view has to say which flag');

  // Its sibling writes the field unconditionally, so the flag belongs to the one adapter.
  assert.equal(apiClassOf(model('azure-openai-responses', { compat: { supportsMaxOutputTokens: false } })), 'single-pool');
  // An undeclared flag is not a switch: the adapter's own default applies.
  assert.equal(apiClassOf(model('openai-responses')), 'single-pool');
  assert.equal(apiClassOf(model('openai-responses', { compat: { supportsMaxOutputTokens: true } })), 'single-pool');
  // The one adapter that never sends a ceiling reports no flag, because none switched it off.
  assert.equal(describeOutboundRequest(model('openai-codex-responses'), balanced, 'medium', 16_000).ceilingFlag, undefined);
});

test('what an attempt may hand back is the number the request actually bounds', () => {
  // An answer-budget API carries the text budget as its output option and the reasoning budget on
  // top of it, so the text is the number to bound.
  assert.equal(acceptedTokens(model('anthropic-messages'), balanced), 12_000);
  // A single pool sends their sum and reasoning draws from inside it. Accepting less than the pool
  // would leave a dead band where a summary the request permitted is refused — 24,000 tokens wide on
  // `deep`, and a second full request every time the model lands in it.
  assert.equal(acceptedTokens(model('openai-responses'), balanced), 20_000);
  assert.equal(acceptedTokens(model('openai-responses'), PRESETS.deep), 36_000);
  // `fast` has no reasoning budget, so the two classes agree and its number is the whole envelope.
  for (const api of ['anthropic-messages', 'openai-responses']) {
    assert.equal(acceptedTokens(model(api), PRESETS.fast), 6_000, api);
  }
  // A no-ceiling API has no acceptance bound to speak of; the hook declines it before any request.
  assert.equal(acceptedTokens(model('openai-codex-responses'), balanced), 20_000);
});

test('the model text is measured without the block the host appends', () => {
  assert.equal(estimateModelTokens('abcd'), 1);
  assert.equal(estimateModelTokens('abcdefgh', 4), 1, 'the appended block is not the model\'s');
  assert.equal(estimateModelTokens('ab', 100), 0, 'never negative');
  assert.equal(estimateModelTokens('abcd'), estimateSummaryTokens('abcd'));
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
  // response is ever observed and a partial summary cannot be told from a clean one.
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
