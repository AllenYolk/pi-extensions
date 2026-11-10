import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_FILE_LIST_ENTRIES } from '../src/preparation.ts';
import { PRESETS, DEFAULT_NEVER_PRUNE } from '../src/config.ts';
import { HOST_PROMPT_AND_TOOLS_TOKENS } from '../src/summarizer.ts';
import { persistedCompactions, READY, runCompaction, statusScript, summarizationRecords } from './run-compaction.mjs';

const CONVERSATION_MODEL = 'minimax-cn/pi-compaction-conversation';
const KEPT_WINDOW_TARGET = 16_000;
/** The pool a preset permits: text budget plus reasoning budget, which is what bounds the request. */
const poolOf = (tuple) => tuple.textBudget + tuple.reasoningBudget;
/** The text a length stop carries. Nothing on any path may put it in the session. */
const PARTIAL = 'PARTIAL-SUMMARY-MUST-NEVER-BE-PERSISTED';
const HEADLINE = 'degraded — compaction handed back to stock Pi';

const markers = (text) => new Set(text?.match(/MARK-[uar]\d+/g) ?? []);
const keptTokens = (report) =>
  report.projection.entries.filter((entry) => entry.type !== 'compaction').reduce((sum, entry) => sum + entry.tokens, 0);

/**
 * The summarization requests this package made. Stock Pi sends no output ceiling and no thinking
 * budget, which is exactly what distinguishes its request from either of ours.
 */
const ours = (records) => summarizationRecords(records).filter((record) => record.options.maxTokens !== undefined);
const stock = (records) => summarizationRecords(records).filter((record) => record.options.maxTokens === undefined);

/** Every handback announces to the same standard: which preset, why, and what the session now does. */
function assertAnnounced(run, { preset, summarizer, why }) {
  assert.match(run.plain, new RegExp(`pi-compaction: ${HEADLINE}`), 'the headline reaches stderr');
  assert.match(run.plain, new RegExp(`Preset: ${preset} — summarizer ${summarizer}`), 'which preset and summarizer');
  assert.match(run.plain, new RegExp(`Why: ${why}`), 'why it degraded');
  assert.match(run.plain, /Now: stock Pi sends no output ceiling at all/, "what the session's behaviour now is");
  assert.match(run.plain, /3,437 to 26,019 tokens across 16 compactions/, 'roughly what that costs');
}

/**
 * The announcement is not a stderr line that scrolls away: the same block is painted again after the
 * host has repainted the transcript, which only the pinned widget can do.
 */
function assertPaintedAfterTheRepaint(run) {
  const repaint = run.plain.indexOf('[compaction] Compacted from');
  assert.ok(repaint >= 0, 'the compaction repainted the transcript');
  const after = run.plain.indexOf(HEADLINE, repaint);
  assert.ok(after > repaint, `the announcement must be visible after the repaint, not only before it:\n${run.plain.slice(repaint, repaint + 400)}`);
}

/** The durable half: a custom session entry, which carries no LLM context, and the status view. */
function assertRecorded(run, { preset, reason }) {
  const entries = readFileSync(run.session.file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const recorded = entries.filter((entry) => entry.type === 'custom' && entry.customType === 'pi-compaction-degradation');
  assert.equal(recorded.length, 1, 'the degradation is recorded in the session');
  assert.equal(recorded[0].data.preset, preset);
  assert.equal(recorded[0].data.reason, reason);
  // It is a record, not context: a custom entry contributes no message to the model.
  const projected = run.report.projection.entries.find((entry) => entry.id === recorded[0].id);
  assert.ok(projected, 'the record is in the session projection');
  assert.deepEqual(projected.roles, [], 'a custom entry contributes no message to the model');
  assert.equal(projected.tokens, 0);
}

/** Nothing truncated or partial reaches the session, from any path. */
function assertNoPartialPersisted(run) {
  const file = readFileSync(run.session.file, 'utf8');
  assert.equal(file.includes(PARTIAL), false, 'a truncated summary reached the session file');
  for (const entry of persistedCompactions(run.session.file)) {
    assert.equal(entry.summary.includes(PARTIAL), false, 'a truncated summary was persisted');
  }
}

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
  assertAnnounced(run, {
    preset: 'balanced',
    summarizer: 'pi-compaction-fixture-codex/codex-summarizer \\(openai-codex-responses\\)',
    why: 'openai-codex-responses sends no output-ceiling field, so the 12000-token text budget and the 8000-token reasoning budget would both be dropped',
  });
  assertPaintedAfterTheRepaint(run);
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the package must not claim a bound it does not have');
  const records = summarizationRecords(run.records);
  assert.equal(records.length, 1, 'only stock Pi asked for a summary');
  assert.equal(records[0].model, CONVERSATION_MODEL);
  assert.equal(records.some((record) => record.model.includes('codex-summarizer')), false, 'no request was made before the handback');
});

test('a length stop is retried exactly once, with the tighter configuration its API class calls for', { timeout: 300_000 }, () => {
  // Both enforceable classes, because the retry is not the same shape on each: the difference is
  // whether the reasoning budget reaches the provider as a token cap.
  const cases = [
    {
      name: 'answer-budget',
      config: {},
      model: CONVERSATION_MODEL,
      api: 'anthropic-messages',
      first: { maxTokens: 12_000, reasoning: 'medium', thinking: 8_000 },
      retry: { maxTokens: 6_000, reasoning: 'medium', thinking: 4_000 },
      instruction: false,
    },
    {
      name: 'single-pool',
      config: { summarizerModel: 'pi-compaction-fixture-pool/pool-summarizer' },
      model: 'pi-compaction-fixture-pool/pool-summarizer',
      api: 'openai-responses',
      first: { maxTokens: 20_000, reasoning: 'medium', thinking: 8_000 },
      // The envelope is left alone: the tighter configuration is the reasoning draw, which is the
      // only thing the adapter cannot bound here, plus the budget stated in words.
      retry: { maxTokens: 20_000, reasoning: undefined, thinking: undefined },
      instruction: true,
    },
  ];

  for (const shape of cases) {
    const run = runCompaction({
      name: `ladder-${shape.name}-`,
      config: { enabled: true, preset: 'balanced', ...shape.config },
      fixture: { MODE: 'length', FAIL_FIRST: 1 },
      turns: 30,
    });
    assert.equal(run.report.error, undefined, run.report.error);

    const attempts = ours(run.records);
    assert.equal(attempts.length, 2, `${shape.name}: exactly one retry`);
    assert.equal(stock(run.records).length, 0, `${shape.name}: stock Pi was never asked`);

    const [first, retry] = attempts;
    for (const [index, attempt] of attempts.entries()) {
      assert.equal(attempt.model, shape.model, shape.name);
      assert.equal(attempt.api, shape.api, shape.name);
      assert.equal(attempt.mode, index === 0 ? 'length' : 'normal', `${shape.name}: attempt ${index + 1}`);
    }
    for (const [attempt, expected] of [[first, shape.first], [retry, shape.retry]]) {
      assert.equal(attempt.options.maxTokens, expected.maxTokens, `${shape.name}: maxTokens`);
      assert.equal(attempt.options.reasoning, expected.reasoning, `${shape.name}: reasoning effort`);
      assert.equal(attempt.options.thinkingBudgets?.medium, expected.thinking, `${shape.name}: thinking budget`);
    }

    // The retry really is tighter, in the dimension that class can tighten.
    if (shape.instruction) {
      assert.equal(first.options.reasoning, 'medium', 'the first attempt reasons');
      assert.equal(retry.options.reasoning, undefined, 'the retry does not draw from the pool uncapped');
      assert.equal(retry.options.thinkingBudgets, undefined, 'and asks for no thinking budget');
      assert.equal(retry.options.maxTokens, first.options.maxTokens, 'the envelope is left alone');
    } else {
      assert.ok(retry.options.maxTokens < first.options.maxTokens, 'the answer budget shrank');
      assert.ok(retry.options.thinkingBudgets.medium < first.options.thinkingBudgets.medium, 'the thinking budget shrank');
    }

    // The budget instruction reaches the request, and only the retry's.
    const focus = /Additional focus: Keep the entire summary within 12000 tokens/;
    assert.equal(focus.test(first.prompt), false, `${shape.name}: the first attempt carries no instruction`);
    assert.equal(focus.test(retry.prompt), shape.instruction, `${shape.name}: the retry's instruction`);

    // The retry succeeded, so its summary is the one the session keeps.
    const [persisted] = persistedCompactions(run.session.file);
    assert.equal(persisted.fromHook, true, `${shape.name}: the retried summary is ours`);
    assert.doesNotMatch(run.plain, new RegExp(HEADLINE), `${shape.name}: a successful retry is not a degradation`);
    assertNoPartialPersisted(run);
  }
});

test('a summary over the text budget is retried once, and the retried summary is persisted when it fits', { timeout: 180_000 }, () => {
  const tuple = PRESETS.balanced;
  const run = runCompaction({
    name: 'oversized-',
    config: { enabled: true, preset: 'balanced' },
    fixture: { MODE: 'oversized', FAIL_FIRST: 1, SUMMARY: 2_000 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  const attempts = ours(run.records);
  assert.equal(attempts.length, 2, 'exactly one retry');
  assert.equal(stock(run.records).length, 0, 'stock Pi was never asked');
  assert.deepEqual(attempts.map((attempt) => attempt.mode), ['oversized', 'normal']);
  // Both attempts are judged against the preset's own text budget; the retry's tighter budget only
  // shapes the request.
  assert.equal(attempts[0].options.maxTokens, tuple.textBudget);
  assert.equal(attempts[1].options.maxTokens, tuple.textBudget / 2, 'the retry asks for less');
  assert.equal(attempts[1].options.thinkingBudgets.medium, tuple.reasoningBudget / 2);

  const [persisted] = persistedCompactions(run.session.file);
  assert.equal(persisted.fromHook, true, 'the retried summary is ours');
  const tokens = Math.ceil(persisted.summary.length / 4);
  assert.ok(tokens <= tuple.textBudget, `the persisted summary is ${tokens} tokens, over the ${tuple.textBudget}-token text budget`);
  assert.doesNotMatch(run.plain, new RegExp(HEADLINE));
  assertNoPartialPersisted(run);
});

test('a second failure degrades to stock Pi, and the ladder cannot loop', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'degrade-',
    config: { enabled: true, preset: 'balanced' },
    // Two failures, so the third summarization request — stock Pi's — is the one that succeeds. A
    // ladder that looped would make that third request itself and would report no degradation.
    fixture: { MODE: 'length', FAIL_FIRST: 2 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  const attempts = ours(run.records);
  assert.equal(attempts.length, 2, 'two rungs, not a loop');
  assert.equal(stock(run.records).length, 1, 'stock Pi then compacted on its own');

  // The session continues, and the compaction it ends up with is the host's.
  const [compaction] = run.report.compactions;
  assert.equal(compaction.ok, true, compaction.error);
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction entry is host-originated');

  const reason =
    'the summarizer hit its output ceiling, so the summary was incomplete, and after a tighter retry '
    + '\\(text budget 12000 to 6000, reasoning budget 8000 to 4000\\) the summarizer hit its output ceiling, so the summary was incomplete';
  assertAnnounced(run, { preset: 'balanced', summarizer: 'minimax-cn/pi-compaction-conversation \\(anthropic-messages\\)', why: reason });
  assertPaintedAfterTheRepaint(run);
  assertRecorded(run, { preset: 'balanced', reason: reason.replace(/\\([()])/g, '$1') });
  assertNoPartialPersisted(run);
});

test('a response that did not stop cleanly is refused, and its partial text is never persisted', { timeout: 180_000 }, () => {
  // The spec's own named case. The host rejects only `error` and `length`; an `aborted` response
  // comes back as a normal result carrying whatever partial text it has, so the package's own
  // reading of the stop reason is the only thing that refuses it.
  const reason = 'the summarizer\'s response stopped with "aborted" instead of finishing, so the summary may be partial';
  const run = runCompaction({
    name: 'aborted-',
    config: { enabled: true, preset: 'balanced' },
    fixture: { STOP_REASON: 'aborted', FAIL_FIRST: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  const attempts = ours(run.records);
  assert.equal(attempts.length, 1, 'one attempt and no retry: a tighter configuration cannot answer a partial response');
  assert.equal(attempts[0].stopReason, 'aborted', 'the response really did carry a stop reason the host does not reject');
  assert.equal(stock(run.records).length, 1, 'stock Pi then compacted on its own');

  // The host was willing to hand this summary back; the session must not contain it.
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction that reached the session is the host\'s, not ours');
  assertNoPartialPersisted(run);

  assertAnnounced(run, {
    preset: 'balanced',
    summarizer: 'minimax-cn/pi-compaction-conversation \\(anthropic-messages\\)',
    why: reason,
  });
  assertPaintedAfterTheRepaint(run);
  assertRecorded(run, { preset: 'balanced', reason });
});

test('a split turn refuses a partial first response even when its second one is clean', { timeout: 180_000 }, () => {
  // A split turn makes two summarization requests through the same stream function and the host
  // concatenates both into one summary, so the last response alone says nothing about the first.
  // The host returns an `aborted` response as a normal result carrying partial text, which is why
  // the package has to read every response the attempt produced.
  const run = runCompaction({
    name: 'split-partial-',
    // A kept window this small puts the cut point inside a turn rather than at a turn's start.
    config: { enabled: true, preset: 'balanced', keptWindowTokens: 1_000 },
    fixture: { STOP_REASON: 'aborted', FAIL_FIRST: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  const attempts = ours(run.records);
  assert.equal(attempts.length, 2, 'a split turn makes two summarization requests through our stream function');
  assert.equal(attempts[0].stopReason, 'aborted', 'the first response carries the partial text');
  assert.equal(attempts[1].stopReason, undefined, 'the second is clean — all a last-response-only check would see');
  assert.equal(stock(run.records).length, 1, 'stock Pi then compacted on its own');

  // The host was willing to concatenate the partial history into the summary; the session must not.
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction that reached the session is the host\'s, not ours');
  assertNoPartialPersisted(run);
  assert.match(run.plain, /Why: the summarizer's response stopped with "aborted"/);
});

test('a summary that used exactly its budget is not refused for the block the host appends', { timeout: 180_000 }, () => {
  // The host appends the file-list block after the model's text. The budget is the model's, so a
  // summary that used all of it has to be accepted: counting the appended block would refuse it and
  // cost a second full request, or a handback, every time a model landed on its budget.
  const tuple = PRESETS.balanced;
  const run = runCompaction({
    name: 'budget-edge-',
    config: { enabled: true, preset: 'balanced' },
    fixture: { SUMMARY: tuple.textBudget },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  assert.equal(ours(run.records).length, 1, 'one attempt: the summary was inside the budget it was given');
  assert.equal(stock(run.records).length, 0, 'stock Pi was never asked');

  const [persisted] = persistedCompactions(run.session.file);
  assert.equal(persisted.fromHook, true, 'the summary is ours');
  assert.ok(persisted.summary.includes('<read-files>'), 'the host appended the file-list block');
  // The persisted total exceeds the text budget precisely because the block is in it — which is the
  // whole reason the acceptance test measures the model's text alone.
  assert.ok(
    Math.ceil(persisted.summary.length / 4) > tuple.textBudget,
    `the persisted total was ${Math.ceil(persisted.summary.length / 4)} tokens, expected more than ${tuple.textBudget}`,
  );
  assert.doesNotMatch(run.plain, new RegExp(HEADLINE), 'and none of that is a degradation');
});

test('a single-pool summary may use the whole envelope the request asked for', { timeout: 180_000 }, () => {
  // The request asks for text budget + reasoning budget as one envelope, and on a single pool
  // reasoning draws from inside it. Refusing anything above the text budget alone left a dead band
  // — 8,000 tokens wide on `balanced`, 24,000 on `deep` — in which a summary the request permitted
  // was rejected, costing a second full request every time a model landed in it.
  const tuple = PRESETS.balanced;
  const run = runCompaction({
    name: 'pool-band-',
    config: { enabled: true, preset: 'balanced', summarizerModel: 'pi-compaction-fixture-pool/pool-summarizer' },
    // Above the text budget, inside the envelope.
    fixture: { SUMMARY: 15_000 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  const attempts = ours(run.records);
  assert.equal(attempts.length, 1, 'one attempt: the summary was inside the envelope the request asked for');
  assert.equal(attempts[0].options.maxTokens, tuple.textBudget + tuple.reasoningBudget, 'and that envelope is the pool');
  assert.equal(stock(run.records).length, 0, 'stock Pi was never asked');

  const [persisted] = persistedCompactions(run.session.file);
  assert.equal(persisted.fromHook, true, 'the summary is ours');
  const tokens = Math.ceil(persisted.summary.length / 4);
  assert.ok(tokens > tuple.textBudget, `the summary was ${tokens} tokens, expected more than the ${tuple.textBudget}-token text budget`);
  assert.doesNotMatch(run.plain, new RegExp(HEADLINE), 'and that is not a degradation');
});

test('a cancellation stops the ladder and starts no new work', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'cancel-',
    config: { enabled: true, preset: 'balanced' },
    // The response that length-stops is the one the user cancels on, which is the moment a ladder
    // would otherwise start a second request.
    fixture: { MODE: 'length', ABORT_AFTER_SUMMARIZE: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  assert.equal(summarizationRecords(run.records).length, 1, 'no retry, and no fallback compaction behind the user');
  assert.deepEqual(persistedCompactions(run.session.file), [], 'nothing was persisted');
  assert.doesNotMatch(run.plain, new RegExp(HEADLINE), 'a cancellation is not a degradation');
  assertNoPartialPersisted(run);
});

test('every path that hands compaction back announces to the same standard', { timeout: 300_000 }, () => {
  const cases = [
    {
      name: 'absent-model',
      config: { enabled: true, preset: 'balanced', summarizerModel: 'pi-compaction-fixture-pool/absent' },
      fixture: {},
      summarizer: 'pi-compaction-fixture-pool/absent',
      why: 'this host does not offer summarizer model pi-compaction-fixture-pool/absent',
      requests: 0,
    },
    {
      name: 'no-credentials',
      config: { enabled: true, preset: 'balanced', summarizerModel: 'pi-compaction-fixture-noauth/unauthenticated-summarizer' },
      fixture: {},
      summarizer: 'pi-compaction-fixture-noauth/unauthenticated-summarizer \\(anthropic-messages\\)',
      why: 'the host has no configured credentials for it',
      requests: 0,
    },
    {
      name: 'model-error',
      config: { enabled: true, preset: 'balanced' },
      // Only our attempt errors, so stock Pi's own request is the one that compacts the session.
      fixture: { MODE: 'error', FAIL_FIRST: 1 },
      summarizer: 'minimax-cn/pi-compaction-conversation \\(anthropic-messages\\)',
      why: 'the summarizer reported an error \\(Summarization failed: fixture summarizer is unavailable\\)',
      // A tighter configuration cannot answer a model error, so it is not paid for twice.
      requests: 1,
    },
    {
      name: 'over-budget-twice',
      config: { enabled: true, preset: 'balanced' },
      fixture: { MODE: 'oversized', SUMMARY: 2_000 },
      summarizer: 'minimax-cn/pi-compaction-conversation \\(anthropic-messages\\)',
      why: 'the summarizer produced a \\d+-token summary, over the 12000 tokens this attempt permits, and after a tighter retry '
        + '\\(text budget 12000 to 6000, reasoning budget 8000 to 4000\\) the summarizer produced a \\d+-token summary, '
        + 'over the 12000 tokens this attempt permits',
      requests: 2,
    },
  ];

  for (const shape of cases) {
    const run = runCompaction({
      name: `announce-${shape.name}-`,
      config: shape.config,
      fixture: shape.fixture,
      turns: 30,
      hold: true,
      script: statusScript,
    });
    assert.equal(run.report.error, undefined, run.report.error);
    assert.equal(ours(run.records).length, shape.requests, `${shape.name}: requests this package made`);
    assert.equal(stock(run.records).length, 1, `${shape.name}: stock Pi compacted on its own`);

    assertAnnounced(run, { preset: 'balanced', summarizer: shape.summarizer, why: shape.why });
    assertPaintedAfterTheRepaint(run);

    const persisted = persistedCompactions(run.session.file);
    assert.equal(persisted.length, 1, shape.name);
    assert.equal(persisted[0].fromHook ?? false, false, `${shape.name}: the compaction is host-originated`);
    assertNoPartialPersisted(run);

    // The record survives the run and is readable from the package's own status view afterwards.
    const entries = readFileSync(run.session.file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const recorded = entries.filter((entry) => entry.type === 'custom' && entry.customType === 'pi-compaction-degradation');
    assert.equal(recorded.length, 1, `${shape.name}: the degradation is recorded in the session`);
    assert.match(run.plain, /Last degradation: preset balanced — /, `${shape.name}: the status view reports it`);
  }
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
  assert.deepEqual(persisted, {
    enabled: false,
    preset: 'deep',
    summarizerModel: null,
    keptWindowTokens: 12_000,
    prune: true,
    pruneWindowTokens: 16_000,
    neverPrune: DEFAULT_NEVER_PRUNE,
  });

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
