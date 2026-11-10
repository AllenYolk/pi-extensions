import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_FILE_LIST_ENTRIES } from '../src/preparation.ts';
import { PRESETS } from '../src/config.ts';
import { HOST_PROMPT_AND_TOOLS_TOKENS } from '../src/summarizer.ts';
import { persistedCompactions, READY, runCompaction, summarizationRecords } from './run-compaction.mjs';

const CONVERSATION_MODEL = 'minimax-cn/pi-compaction-conversation';
const KEPT_WINDOW_TARGET = 16_000;
/** The pool a preset permits: text budget plus reasoning budget, which is what bounds the request. */
const poolOf = (tuple) => tuple.textBudget + tuple.reasoningBudget;

const markers = (text) => new Set(text?.match(/MARK-[uar]\d+/g) ?? []);
const keptTokens = (report) =>
  report.projection.entries.filter((entry) => entry.type !== 'compaction').reduce((sum, entry) => sum + entry.tokens, 0);

/** Everything above the cut point was summarised and everything below it was kept, with no overlap. */
function assertNothingLost(run) {
  const prompt = markers(summarizationRecords(run.records).map((record) => record.prompt).join('\n'));
  const kept = markers(run.report.projection.entries.map((entry) => entry.text).join('\n'));
  const all = markers(run.report.entries.map((entry) => entry.text ?? '').join('\n'));
  assert.ok(all.size > 0);
  assert.deepEqual([...all].filter((marker) => !prompt.has(marker) && !kept.has(marker)), [], 'a message was neither summarised nor kept');
  assert.deepEqual([...prompt].filter((marker) => kept.has(marker)), [], 'a message was both summarised and kept');
  assert.equal(prompt.size + kept.size, all.size);
  return { summarised: prompt.size, kept: kept.size, total: all.size };
}

function assertStock(run) {
  const records = summarizationRecords(run.records);
  assert.equal(records.length, 1, 'stock Pi issues exactly one summarization request');
  assert.equal(records[0].model, CONVERSATION_MODEL);
  assert.equal(records[0].options.maxTokens, undefined, 'stock Pi sends no output ceiling');
  assert.equal(records[0].options.thinkingBudgets, undefined);
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction must not be hook-originated');
}

test('the package is inert until it is enabled', { timeout: 180_000 }, () => {
  assertStock(runCompaction({ name: 'inert-', turns: 30 }));
});

test('the off preset returns compaction to stock Pi', { timeout: 180_000 }, () => {
  assertStock(runCompaction({ name: 'off-', config: { enabled: true, preset: 'off' }, turns: 30 }));
});

test('every preset summarises with the conversation model by default', { timeout: 180_000 }, () => {
  for (const preset of ['fast', 'balanced', 'deep']) {
    const run = runCompaction({
      name: `default-${preset}-`,
      config: { enabled: true, preset },
      turns: 30,
    });
    const [record] = summarizationRecords(run.records);
    assert.equal(record.model, CONVERSATION_MODEL, preset);
    assert.equal(record.api, 'anthropic-messages', preset);
    const tuple = PRESETS[preset];
    assert.equal(record.options.reasoning, tuple.reasoningBudget === 0 ? undefined : tuple.thinking, preset);
    assert.equal(record.options.maxTokens, tuple.textBudget, `${preset}: an answer-budget API gets the text budget`);
    assert.equal(record.options.thinkingBudgets?.medium ?? 0, tuple.reasoningBudget, preset);
    assert.equal(persistedCompactions(run.session.file)[0].fromHook, true, preset);
  }
});

test('an explicitly configured summarizer model, and the thinking level, reach the request', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'swap-',
    config: { enabled: true, preset: 'balanced', summarizerModel: 'minimax-cn/minimax-M3.1-Flash' },
    // The session runs at high thinking; the summarizer must not inherit it.
    probe: { THINKING: 'high' },
    turns: 40,
  });
  const records = summarizationRecords(run.records);
  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.model, 'minimax-cn/minimax-M3.1-Flash', 'the summarizer is not the conversation model');
  assert.equal(record.api, 'anthropic-messages');
  assert.equal(record.options.reasoning, 'medium', 'the session level must not leak into the summarizer');
  assert.equal(record.options.maxTokens, PRESETS.balanced.textBudget);
  assert.deepEqual(record.options.thinkingBudgets, { minimal: 8_000, low: 8_000, medium: 8_000, high: 8_000 });
  assert.equal(record.options.maxTokens + record.options.thinkingBudgets.medium, poolOf(PRESETS.balanced));
  assert.equal(record.options.cacheRetention, 'none', 'the host opts the summary request out of prompt caching');
  // compact() called with our own stream function supplies neither callback; the fixture honours
  // them when they are present, which the conversation requests in the two-round run show.
  assert.deepEqual(record.honours, { onPayload: false, onResponse: false });

  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook, true);
  assertNothingLost(run);
});

test('a single-pool API receives both budgets as one output option', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'pool-',
    config: { enabled: true, preset: 'balanced', summarizerModel: 'pi-compaction-fixture-pool/pool-summarizer' },
    turns: 30,
  });
  const [record] = summarizationRecords(run.records);
  assert.equal(record.api, 'openai-responses');
  assert.equal(record.options.maxTokens, poolOf(PRESETS.balanced));
  assert.equal(record.options.thinkingBudgets.high, PRESETS.balanced.reasoningBudget);
});

test('an unsupported thinking level is clamped before the request', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'clamp-',
    config: { enabled: true, preset: 'balanced', summarizerModel: 'minimax-cn/minimax-M3.1-Flash-no-medium' },
    turns: 30,
  });
  const [record] = summarizationRecords(run.records);
  assert.equal(record.options.reasoning, 'high', 'medium is unsupported on that model');
  assert.equal(record.options.thinkingBudgets.high, PRESETS.balanced.reasoningBudget, 'the absolute budget survives the clamp');
  assert.equal(record.options.maxTokens, PRESETS.balanced.textBudget);
});

test('a summarizer on an API that sends no output ceiling hands compaction back', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'no-ceiling-',
    config: { enabled: true, preset: 'balanced', summarizerModel: 'pi-compaction-fixture-codex/codex-summarizer' },
    turns: 30,
  });
  assert.match(run.plain, /cannot bound the summary: openai-codex-responses sends no output-ceiling field/);
  assert.match(run.plain, /compaction handed back to Pi/);
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the package must not claim a bound it does not have');
  const records = summarizationRecords(run.records);
  assert.equal(records.length, 1, 'only stock Pi asked for a summary');
  assert.equal(records[0].model, CONVERSATION_MODEL);
  assert.equal(records.some((record) => record.model.includes('codex-summarizer')), false);
});

test('a summary over the text budget is never persisted by this package', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'oversized-',
    config: { enabled: true, preset: 'balanced' },
    fixture: { MODE: 'oversized', SUMMARY: 2_000 },
    turns: 30,
  });
  assert.match(run.plain, /pi-compaction: preset balanced produced a \d+-token summary/);
  assert.match(run.plain, /over its 12000-token text budget/);
  assert.match(run.plain, /compaction is handed back to Pi/);
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the oversized summary must not be ours');
  const ours = summarizationRecords(run.records).filter((record) => record.options.thinkingBudgets !== undefined);
  assert.equal(ours.length, 1, 'we tried once and then handed compaction back');
  assert.equal(summarizationRecords(run.records).length, 2, 'stock Pi then compacted on its own');
});

test('a second compaction does not inherit the first one\'s file lists', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'twice-',
    config: { enabled: true, preset: 'balanced', keptWindowTokens: 4_000 },
    fixture: { WRITE: '/tmp/pi-compaction-fixture-write.txt' },
    // The follow-up has to carry the session past the host's own recent-token setting, or the host
    // declines to prepare a second compaction at all.
    probe: { ROUNDS: 2, FOLLOWUP: 24_000 },
    turns: 40,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  assert.deepEqual(run.report.compactions.map((compaction) => compaction.ok), [true, true], JSON.stringify(run.report.compactions));
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 2);
  assert.deepEqual(persisted.map((entry) => entry.fromHook), [true, true]);

  for (const entry of persisted) {
    assert.ok(entry.details.readFiles.length <= MAX_FILE_LIST_ENTRIES, JSON.stringify(entry.details.readFiles.length));
    assert.ok(entry.details.modifiedFiles.length <= MAX_FILE_LIST_ENTRIES);
  }
  const [first, second] = persisted.map((entry) => entry.details);
  // The first compaction's range covered the early turns; the second one's does not, so any of
  // their paths in the second summary could only have come from the first compaction's details.
  const early = (path) => /\/fixture\/(?:read|edit)-[0-9]-/.test(path);
  assert.ok(first.readFiles.some(early), 'the first compaction must have covered the early turns');
  assert.deepEqual(second.readFiles.filter(early), []);
  assert.deepEqual(second.modifiedFiles.filter(early), []);

  // The conversation turn between the two compactions is a real one, and it honours both callbacks.
  const conversation = run.records.filter((record) => !record.summarization);
  assert.ok(conversation.length >= 2);
  assert.deepEqual(conversation[0].honours, { onPayload: true, onResponse: true });
  assertNothingLost(run);
});

test('activation, reload and disposal leave no residue', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'reload-',
    config: { enabled: true, preset: 'balanced' },
    probe: { RELOADS: 2 },
    script: [
      { expect: READY, send: '/reload\r' },
      { expect: READY, send: '/reload\r' },
      { expect: READY, send: '/compaction-probe\r' },
    ],
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  // A duplicated handler would issue a second summarization request for one compaction.
  assert.equal(summarizationRecords(run.records).length, 1);
  assert.equal(persistedCompactions(run.session.file)[0].fromHook, true);
  assertNothingLost(run);
});

test('the command shows status and sets every knob without shadowing /compact', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'command-',
    config: { enabled: true, preset: 'balanced' },
    turns: 30,
    script: [
      { expect: READY, send: '/compaction\r' },
      { expect: 'Host seam:', send: '/compaction model pi-compaction-fixture-pool/pool-summarizer\r' },
      { expect: 'openai-responses', send: '/compaction model conversation\r' },
      { expect: 'pi-compaction-conversation', send: '/compaction thinking high\r' },
      { expect: 'Thinking: high', send: '/compaction text 9000\r' },
      { expect: 'Text budget: 9000', send: '/compaction reasoning 1500\r' },
      { expect: 'Reasoning budget: 1500', send: '/compaction reasoning 0\r' },
      { expect: '(no reasoning budget)', send: '/compaction reasoning 1500\r' },
      { expect: 'Reasoning budget: 1500', send: '/compaction window 12000\r' },
      { expect: 'Kept window: 12000 tokens', send: '/compaction preset fast\r' },
      // A preset is the whole tuple: it drops the per-field overrides set before it.
      { expect: 'Preset: fast', send: '/compaction thinking nonsense\r' },
      { expect: 'nothing changed', send: '/compaction preset deep\r' },
      { expect: 'Preset: deep', send: '/compaction disable\r' },
      { expect: 'Enabled: no', send: '/compact\r' },
      { expect: 'Compacted from', send: '/compaction-probe\r' },
    ],
  });
  assert.equal(run.report.error, undefined, run.report.error);

  // The status view reports the effective tuple, what the provider will actually see, and the
  // worst case that follows.
  assert.match(run.plain, /Preset: balanced/);
  assert.match(run.plain, /Summarizer model: minimax-cn\/pi-compaction-conversation \(anthropic-messages\)/);
  assert.match(run.plain, /Thinking: medium/);
  assert.match(run.plain, /Text budget: 12000/);
  assert.match(run.plain, /Reasoning budget: 8000/);
  assert.match(run.plain, /Outbound: answer-budget API anthropic-messages . the provider sees an output ceiling of 20000/);
  assert.match(run.plain, /Reasoning budget on this API: enforced as a thinking budget of 8000; at least 12000 of room remains available for text/);
  assert.match(run.plain, /Worst case: summary 20000 tokens; base context 34874 \+ 20000 \+ 16000 = 70874 tokens/);
  assert.match(run.plain, /Kept window: 16000 tokens/);
  assert.match(run.plain, /Enabled: yes/);
  assert.match(run.plain, /Host seam: ok .*compact\(\) arity 12/);
  // A single-pool API is labelled advisory, because its adapter never reads thinkingBudgets.
  assert.match(run.plain, /Reasoning budget on this API: advisory . openai-responses sends a reasoning effort level/);
  // A zero reasoning budget turns the summarizer's thinking off, and says so rather than
  // reporting it as a clamp.
  assert.match(run.plain, /Thinking: off \(no reasoning budget\)/);
  assert.match(run.plain, /Error: pi-compaction: nothing changed; thinking must be/);

  const persisted = JSON.parse(readFileSync(join(run.agent, 'extensions/pi-compaction/config.json'), 'utf8'));
  assert.deepEqual(persisted, { enabled: false, preset: 'deep', summarizerModel: null, keptWindowTokens: 12_000 });

  // `/compaction` must not shadow the host's own `/compact`, which still compacts on its own.
  const compactions = persistedCompactions(run.session.file);
  assert.equal(compactions.length, 1, 'the host\'s /compact must still have compacted');
  assert.equal(compactions[0].fromHook ?? false, false, 'with the package disabled, that compaction is stock');

  const names = run.report.commands.map((command) => command.name);
  assert.ok(names.includes('compaction'));
  assert.equal(run.report.commands.find((command) => command.name === 'compaction').source, 'extension');
});

test('acceptance: the summary and the base context stay inside what the preset constructs', { timeout: 180_000 }, () => {
  const tuple = PRESETS.balanced;
  const pool = poolOf(tuple);
  const run = runCompaction({
    name: 'acceptance-',
    config: { enabled: true, preset: 'balanced' },
    // A summary at the size the preset's text budget is meant to bound.
    fixture: { SUMMARY: 11_500 },
    turns: 40,
  });
  const [compaction] = run.report.compactions;
  assert.equal(compaction.ok, true, compaction.error);
  const persisted = persistedCompactions(run.session.file)[0];
  assert.equal(persisted.fromHook, true);

  const summaryTokens = Math.ceil(persisted.summary.length / 4);
  const kept = keptTokens(run.report);
  const baseContext = HOST_PROMPT_AND_TOOLS_TOKENS + summaryTokens + kept;
  // The request permits the pool; the package additionally refuses to persist anything over the
  // text budget, so the summary that reaches the session is inside both.
  const [record] = summarizationRecords(run.records);
  assert.equal(record.options.maxTokens, tuple.textBudget);
  assert.equal(record.options.maxTokens + record.options.thinkingBudgets.medium, pool);
  assert.ok(summaryTokens <= pool, `summary was ${summaryTokens} tokens, over the ${pool}-token pool`);
  assert.ok(summaryTokens <= tuple.textBudget, `summary was ${summaryTokens} tokens, over the ${tuple.textBudget}-token text budget`);
  assert.ok(kept <= KEPT_WINDOW_TARGET + 1_500, `kept window was ${kept} tokens`);
  assertNothingLost(run);
  console.log(
    `acceptance: summary ${summaryTokens} tokens (${persisted.summary.length} chars), kept window ${kept} tokens, ` +
    `base context ${HOST_PROMPT_AND_TOOLS_TOKENS} + ${summaryTokens} + ${kept} = ${baseContext} tokens; ` +
    `preset pool ${pool}, so the construction bound for this kept window is ` +
    `${HOST_PROMPT_AND_TOOLS_TOKENS + pool + kept} tokens ` +
    `(synthetic profile's own prompt: ${run.report.systemPromptTokens} tokens, tools: ${run.report.activeTools.join(', ')})`,
  );
});
