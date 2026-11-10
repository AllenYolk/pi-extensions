import assert from 'node:assert/strict';
import { test } from 'node:test';
import { announcement, budgetInstruction, describeFailure, ladder } from '../src/ladder.ts';
import { summarizerThinkingLevel } from '../src/summarizer.ts';
import { PRESETS } from '../src/config.ts';

const model = (api, extra = {}) => ({
  id: 'm', provider: 'p', name: 'm', api, reasoning: true, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000, maxTokens: 64_000, ...extra,
});

const balanced = PRESETS.balanced;

test('the ladder is two rungs on every API class, so the retry cannot become a loop', () => {
  for (const api of ['anthropic-messages', 'bedrock-converse-stream', 'openai-responses', 'openai-completions', 'some-future-api']) {
    assert.equal(ladder(model(api), balanced, 'medium').length, 2, api);
  }
});

test('the first rung is the preset itself', () => {
  for (const api of ['anthropic-messages', 'openai-responses']) {
    const [first] = ladder(model(api), balanced, 'medium');
    assert.equal(first.thinking, 'medium', api);
    assert.equal(first.instruction, undefined, `${api}: the preset asks for no extra instruction`);
    assert.deepEqual(first.budgets, {
      maxTokens: api === 'anthropic-messages' ? 12_000 : 20_000,
      thinkingBudgets: { minimal: 8_000, low: 8_000, medium: 8_000, high: 8_000 },
    }, api);
  }
});

test('an answer-budget retry compresses both budgets, because thinking may have eaten the quota', () => {
  const [, retry] = ladder(model('anthropic-messages'), balanced, 'medium');
  assert.equal(retry.thinking, 'medium', 'the model still reasons, with less room');
  assert.equal(retry.budgets.maxTokens, 6_000);
  assert.deepEqual(retry.budgets.thinkingBudgets, { minimal: 4_000, low: 4_000, medium: 4_000, high: 4_000 });
  assert.equal(retry.instruction, undefined, 'the provider enforces the smaller ceiling itself');
  assert.match(retry.tightening, /text budget 12000 to 6000, reasoning budget 8000 to 4000/);
});

test('a single-pool retry drops the reasoning draw and leaves the envelope alone', () => {
  for (const api of ['openai-responses', 'openai-completions']) {
    const [, retry] = ladder(model(api), balanced, 'medium');
    assert.equal(retry.thinking, 'off', `${api}: the adapter cannot cap reasoning, so the retry stops asking for it`);
    assert.equal(retry.budgets.maxTokens, 20_000, `${api}: the envelope is unchanged: shrinking it makes a second length stop likelier`);
    assert.equal(retry.budgets.thinkingBudgets, undefined, api);
    assert.equal(retry.instruction, budgetInstruction(12_000), api);
    assert.match(retry.tightening, /thinking off and an explicit 12000-token budget instruction/, api);
  }
});

test('the tighter rung clamps off on a model that does not support it', () => {
  // The host only omits its reasoning option for a level of exactly `off`, so handing it an
  // unsupported `off` leaves the adapter to its own default effort — which can be higher than the
  // first rung's, the opposite of what a tighter retry is for.
  const noOff = model('openai-responses', {
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high' },
  });
  assert.equal(summarizerThinkingLevel(noOff, balanced), 'medium', 'the first rung still asks for medium');
  const [, retry] = ladder(noOff, balanced, 'medium');
  assert.equal(retry.thinking, 'low', 'the lowest level this model actually supports');
  assert.match(retry.tightening, /thinking down to low, its lowest supported level/);
  assert.equal(retry.instruction, budgetInstruction(12_000), 'the budget still has to be stated in words');
  assert.equal(retry.budgets.maxTokens, 20_000, 'and the envelope is still left alone');
  // The reasoning draw cannot be removed, so the budget that could cap it is sent rather than dropped.
  assert.deepEqual(retry.budgets.thinkingBudgets, { minimal: 8_000, low: 8_000, medium: 8_000, high: 8_000 });
});

test('a model with no off at all still gets the lowest level it has', () => {
  const high = model('openai-responses', { thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: 'high' } });
  assert.equal(summarizerThinkingLevel(high, PRESETS.fast), 'high', 'fast asks for off and gets the lowest supported level');
  assert.equal(ladder(high, PRESETS.fast, 'high')[1].thinking, 'high');
});

test('a zero reasoning budget stays zero, and a one-token text budget is not halved away', () => {
  const [, fast] = ladder(model('anthropic-messages'), PRESETS.fast, 'off');
  assert.equal(fast.budgets.maxTokens, 3_000);
  assert.equal(fast.budgets.thinkingBudgets, undefined, 'zero means the summarizer does not reason');

  const tiny = { model: null, thinking: 'low', textBudget: 1, reasoningBudget: 1 };
  const [, retry] = ladder(model('anthropic-messages'), tiny, 'low');
  assert.equal(retry.budgets.maxTokens, 1);
  assert.equal(retry.budgets.thinkingBudgets.medium, 1);
});

test('the budget instruction names the budget and asks for shorter rather than incomplete', () => {
  const instruction = budgetInstruction(12_000);
  assert.match(instruction, /within 12000 tokens/);
  assert.match(instruction, /shorter summary rather than an incomplete one/);
});

test('a failure is described from the response, not from the host\'s prose', () => {
  assert.match(describeFailure({ stopReason: 'length', toolCall: false }, new Error('x')), /hit its output ceiling/);
  assert.match(describeFailure({ stopReason: 'stop', toolCall: true }, new Error('x')), /tried to call a tool/);
  assert.match(describeFailure({ stopReason: 'error', toolCall: false }, new Error('boom')), /reported an error \(boom\)/);
  assert.match(describeFailure({ stopReason: 'aborted', toolCall: false }, new Error('x')), /stopped with "aborted" instead of finishing/);
  assert.match(describeFailure(undefined, new Error('boom')), /did not produce a summary \(boom\)/);
});

test('the announcement names the preset, the reason, the new behaviour and its cost', () => {
  const lines = announcement({ preset: 'balanced', summarizer: 'p/m (anthropic-messages)', reason: 'because' });
  assert.equal(lines.length, 5);
  assert.match(lines[0], /degraded — compaction handed back to stock Pi/);
  assert.equal(lines[1], 'Preset: balanced — summarizer p/m (anthropic-messages)');
  assert.equal(lines[2], 'Why: because');
  assert.match(lines[3], /Now: stock Pi sends no output ceiling at all/);
  assert.match(lines[3], /3,437 to 26,019 tokens across 16 compactions/);
  assert.match(lines[4], /Next: \/compaction preset fast/);
});
