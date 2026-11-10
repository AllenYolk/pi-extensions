import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compact } from '@earendil-works/pi-coding-agent';
import {
  checkHostSeam,
  clampThinkingLevel,
  estimateSummaryTokens,
  outputBudgets,
  summarizerThinkingLevel,
} from '../src/summarizer.ts';
import { PRESETS } from '../src/config.ts';

const model = (api, extra = {}) => ({
  id: 'm', provider: 'p', name: 'm', api, reasoning: true, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000, maxTokens: 64_000, ...extra,
});

const balanced = PRESETS.balanced;

test('an answer-budget API gets the text budget as its output option and the reasoning budget on top', () => {
  for (const api of ['anthropic-messages', 'bedrock-converse-stream', 'google-generative-ai', 'google-vertex']) {
    const budgets = outputBudgets(model(api), balanced, 'medium');
    assert.equal(budgets.maxTokens, balanced.textBudget, api);
    assert.deepEqual(budgets.thinkingBudgets, { minimal: 8_000, low: 8_000, medium: 8_000, high: 8_000 }, api);
    // Their sum is the ceiling, and the text budget is a floor the reasoning phase cannot eat into.
    assert.equal(budgets.maxTokens + budgets.thinkingBudgets.medium, 20_000, api);
  }
});

test('a single-pool API gets both budgets as one output option', () => {
  for (const api of ['openai-responses', 'openai-completions', 'mistral-conversations', 'some-future-api']) {
    const budgets = outputBudgets(model(api), balanced, 'medium');
    assert.equal(budgets.maxTokens, balanced.textBudget + balanced.reasoningBudget, api);
    assert.equal(budgets.maxTokens, 20_000, api);
  }
});

test('the reasoning budget is absolute, so a clamped level still gets it', () => {
  const budgets = outputBudgets(model('anthropic-messages'), balanced, 'high');
  assert.equal(budgets.thinkingBudgets.high, 8_000);
  assert.equal(budgets.thinkingBudgets.medium, 8_000, 'every level carries the same absolute budget');
});

test('thinking off sends no thinking budget and leaves the text budget as the whole ceiling', () => {
  for (const api of ['anthropic-messages', 'openai-responses']) {
    const budgets = outputBudgets(model(api), PRESETS.fast, 'off');
    assert.equal(budgets.maxTokens, 6_000, api);
    assert.equal(budgets.thinkingBudgets, undefined, api);
  }
});

test('a zero reasoning budget turns the summarizer\'s thinking off', () => {
  const tuple = { model: 'p/m', thinking: 'high', textBudget: 6_000, reasoningBudget: 0 };
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

test('a summary is measured with the host\'s own four-characters-per-token estimate', () => {
  assert.equal(estimateSummaryTokens(''), 0);
  assert.equal(estimateSummaryTokens('abcd'), 1);
  assert.equal(estimateSummaryTokens('a'.repeat(48_000)), 12_000);
});

test('the host seam check accepts this package\'s host and reports what it saw', async () => {
  const result = await checkHostSeam();
  assert.equal(result.ok, true, result.detail);
  assert.match(result.detail, /arity 12/);
  assert.match(result.detail, /cacheRetention/);
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
