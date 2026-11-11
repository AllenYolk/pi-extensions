import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_FILE_LIST_ENTRIES } from '../src/preparation.ts';
import { DEFAULT_KEPT_WINDOW_TOKENS } from '../src/config.ts';
import { persistedCompactions, READY, runCompaction, statusScript, summarizationRecords } from './run-compaction.mjs';

const CONVERSATION_MODEL = 'minimax-cn/pi-compaction-conversation';
/** The text an aborted response carries. Nothing on any path may put it in the session. */
const PARTIAL = 'PARTIAL-SUMMARY-MUST-NEVER-BE-PERSISTED';
const HEADLINE = 'degraded — compaction handed back to stock Pi';

const markers = (text) => new Set(text?.match(/MARK-[uar]\d+/g) ?? []);

/**
 * The summarization requests this package made. Stock Pi sends no output ceiling — and neither do we
 * any more — so the model is what distinguishes our request from the host's.
 */
const ours = (records) => summarizationRecords(records).filter((record) => record.options.maxTokens === undefined);

/** Every handback announces to the same standard: which summarizer, why, and what happens now. */
function assertAnnounced(run, { summarizer, why }) {
  assert.match(run.plain, new RegExp(`pi-compaction: ${HEADLINE}`), 'the headline reaches stderr');
  assert.match(run.plain, new RegExp(`Summarizer: ${summarizer}`), 'which summarizer');
  assert.match(run.plain, new RegExp(`Why: ${why}`), 'why it degraded');
  assert.match(run.plain, /Now: stock Pi compacts with the conversation model and the session's own thinking level/);
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
function assertRecorded(run, { reason }) {
  const entries = readFileSync(run.session.file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const recorded = entries.filter((entry) => entry.type === 'custom' && entry.customType === 'pi-compaction-degradation');
  assert.equal(recorded.length, 1, 'the degradation is recorded in the session');
  assert.equal(recorded[0].data.reason, reason);
  // It is a record, not context: a custom entry contributes no message to the model.
  const projected = run.report.projection.entries.find((entry) => entry.id === recorded[0].id);
  assert.ok(projected, 'the record is in the session projection');
  assert.deepEqual(projected.roles, [], 'a custom entry contributes no message to the model');
  assert.equal(projected.tokens, 0);
}

/** Nothing partial reaches the session, from any path. */
function assertNoPartialPersisted(run) {
  const file = readFileSync(run.session.file, 'utf8');
  assert.equal(file.includes(PARTIAL), false, 'a partial summary reached the session file');
  for (const entry of persistedCompactions(run.session.file)) {
    assert.equal(entry.summary.includes(PARTIAL), false, 'a partial summary was persisted');
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
}

function assertStock(run) {
  const records = summarizationRecords(run.records);
  assert.equal(records.length, 1, 'stock Pi issues exactly one summarization request');
  assert.equal(records[0].model, CONVERSATION_MODEL);
  // No output ceiling from either path: this package no longer sends one.
  assert.equal(records[0].options.maxTokens, undefined, 'no output ceiling');
  assert.equal(records[0].options.thinkingBudgets, undefined);
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction must not be hook-originated');
}

test('the package is inert until it is enabled', { timeout: 180_000 }, () => {
  assertStock(runCompaction({ name: 'inert-', turns: 30 }));
});

test('the package sends no output ceiling of its own', { timeout: 180_000 }, () => {
  // The summary is not bounded by this package. The provider's own limit is the only ceiling, which
  // is what stock Pi does too — the difference this package makes is which model runs.
  const run = runCompaction({ name: 'no-ceiling-ours-', config: { enabled: true }, turns: 30 });
  const [record] = summarizationRecords(run.records);
  assert.equal(record.options.maxTokens, undefined, 'no maxTokens is injected');
  assert.equal(record.options.thinkingBudgets, undefined, 'and no thinking budget');
  const [persisted] = persistedCompactions(run.session.file);
  assert.equal(persisted.fromHook, true, 'the summary is ours');
  // And it is whole: the model's own text is in it, with the host's file-list block appended.
  assert.match(persisted.summary, /FIXTURE-SUMMARY/, 'the model\'s text is in the summary');
  assert.ok(persisted.summary.includes('<read-files>'), 'and the host appended its file-list block');
});

test('a length stop is refused: the summary would be cut, which is what must never persist', { timeout: 180_000 }, () => {
  // This package sends no output ceiling, so a length stop is not the budget working — it is the
  // summarizer hitting the model's own limit, and the summary is genuinely incomplete. ADR 0005 is
  // why that is refused rather than accepted.
  const run = runCompaction({
    name: 'length-',
    config: { enabled: true },
    fixture: { MODE: 'length', FAIL_FIRST: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  assert.equal(summarizationRecords(run.records).length, 2, 'our attempt, then stock Pi\'s own');

  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the truncated summary is not ours to persist');
  assert.equal(persisted[0].summary.includes('TRUNCATED-AT-THE-CEILING'), false, 'and the cut text is nowhere in the session');
  assertAnnounced(run, {
    summarizer: 'minimax-cn/pi-compaction-conversation \\(anthropic-messages\\)',
    why: 'the summarizer\'s response stopped with "length" instead of finishing, so the summary may be partial',
  });
});

test('the summarizer model and its thinking level reach the request', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'swap-',
    config: { enabled: true, summarizerModel: 'minimax-cn/minimax-M3.1-Flash', thinking: 'off' },
    // The session runs at high thinking; the summarizer must not inherit it.
    probe: { THINKING: 'high' },
    turns: 40,
  });
  const records = summarizationRecords(run.records);
  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.model, 'minimax-cn/minimax-M3.1-Flash', 'the summarizer is not the conversation model');
  assert.equal(record.api, 'anthropic-messages');
  assert.equal(record.options.reasoning, undefined, 'thinking off means the host omits its reasoning option');
  assert.equal(record.options.maxTokens, undefined, 'and no ceiling is added');
  assert.equal(record.options.cacheRetention, 'none', 'the host opts the summary request out of prompt caching');
  assert.deepEqual(record.honours, { onPayload: false, onResponse: false });

  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook, true);
  assertNothingLost(run);
});

test('a thinking level the model does not support is clamped before the request', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'clamp-',
    config: { enabled: true, summarizerModel: 'minimax-cn/minimax-M3.1-Flash-no-medium', thinking: 'medium' },
    turns: 30,
  });
  const [record] = summarizationRecords(run.records);
  assert.equal(record.options.reasoning, 'high', 'medium is unsupported on that model, so a higher one wins');
});

test('a model that cannot stop reasoning is reported honestly', { timeout: 180_000 }, () => {
  // `off` and `minimal` unsupported is the shape of a reasoning model that cannot be told not to
  // reason — the owner's own conversation model among them.
  const run = runCompaction({
    name: 'no-off-',
    config: { enabled: true, summarizerModel: 'minimax-cn/pi-compaction-no-off', thinking: 'off' },
    turns: 30,
    hold: true,
    script: statusScript,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  const [record] = summarizationRecords(run.records);
  assert.equal(record.options.reasoning, 'low', 'the host is told to reason at the lowest level this model has');
  assert.match(run.plain, /Thinking: low \(clamped from off; this model has no off, so its reasoning phase still runs\)/);
});

test('a response that did not stop cleanly is refused, and its partial text is never persisted', { timeout: 180_000 }, () => {
  // The specification's own named case. The host rejects only `error` and `length`, and a tool call
  // separately; an `aborted` response comes back as a normal result carrying whatever partial text it
  // has, so the package's own reading of the stop reason is the only thing that refuses it.
  const reason = 'the summarizer\'s response stopped with "aborted" instead of finishing, so the summary may be partial';
  const run = runCompaction({
    name: 'aborted-',
    config: { enabled: true },
    fixture: { STOP_REASON: 'aborted', FAIL_FIRST: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  assert.equal(summarizationRecords(run.records).length, 2, 'our attempt, then stock Pi\'s own');
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction that reached the session is the host\'s, not ours');
  assertNoPartialPersisted(run);

  assertAnnounced(run, {
    summarizer: 'minimax-cn/pi-compaction-conversation \\(anthropic-messages\\)',
    why: reason,
  });
  assertPaintedAfterTheRepaint(run);
  assertRecorded(run, { reason });
});

test('a split turn refuses a partial first response even when its second one is clean', { timeout: 180_000 }, () => {
  // A split turn makes two summarization requests through the same stream function and the host
  // concatenates both into one summary, so the last response alone says nothing about the first.
  const run = runCompaction({
    name: 'split-partial-',
    // A kept window this small puts the cut point inside a turn rather than at a turn's start.
    config: { enabled: true, keptWindowTokens: 1_000 },
    fixture: { STOP_REASON: 'aborted', FAIL_FIRST: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  const attempts = summarizationRecords(run.records).filter((record) => record.stopReason !== undefined || record.summarization);
  const oursOnly = attempts.filter((record) => record.mode === 'aborted' || record.stopReason === 'aborted');
  assert.ok(oursOnly.length >= 1, 'the first response carries the partial text');

  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction that reached the session is the host\'s');
  assertNoPartialPersisted(run);
});

test('a model error hands compaction back to stock Pi', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'degrade-',
    config: { enabled: true },
    // Only our attempt errors, so stock Pi's own request is the one that compacts the session.
    fixture: { MODE: 'error', FAIL_FIRST: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  assert.equal(summarizationRecords(run.records).length, 2, 'our attempt, then stock Pi\'s own');

  // The session continues, and the compaction it ends up with is the host's.
  const [compaction] = run.report.compactions;
  assert.equal(compaction.ok, true, compaction.error);
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction entry is host-originated');

  const reason = 'the summarizer reported an error \\(Summarization failed: fixture summarizer is unavailable\\)';
  assertAnnounced(run, {
    summarizer: 'minimax-cn/pi-compaction-conversation \\(anthropic-messages\\)',
    why: reason,
  });
  assertPaintedAfterTheRepaint(run);
  assertRecorded(run, { reason: reason.replace(/\\([()])/g, '$1') });
  assertNoPartialPersisted(run);
});

test('a cancellation stops the compaction and starts no new work', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'cancel-',
    config: { enabled: true },
    // The user cancels on the summarization response, which is after our request and before anything
    // is persisted — the one moment a handback would start a fresh compaction behind them.
    fixture: { MODE: 'normal', ABORT_AFTER_SUMMARIZE: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  assert.equal(summarizationRecords(run.records).length, 1, 'one request, and no fallback compaction behind the user');
  assert.deepEqual(persistedCompactions(run.session.file), [], 'nothing was persisted');
  assert.doesNotMatch(run.plain, new RegExp(HEADLINE), 'a cancellation is not a degradation');
  assertNoPartialPersisted(run);
});

test('every path that hands compaction back announces to the same standard', { timeout: 300_000 }, () => {
  const cases = [
    {
      name: 'absent-model',
      config: { enabled: true, summarizerModel: 'pi-compaction-fixture-pool/absent' },
      summarizer: 'pi-compaction-fixture-pool/absent',
      why: 'this host does not offer summarizer model pi-compaction-fixture-pool/absent',
      requests: 0,
    },
    {
      name: 'no-credentials',
      config: { enabled: true, summarizerModel: 'pi-compaction-fixture-noauth/unauthenticated-summarizer' },
      summarizer: 'pi-compaction-fixture-noauth/unauthenticated-summarizer \\(anthropic-messages\\)',
      why: 'the host has no configured credentials for it',
      requests: 0,
    },
    {
      name: 'model-error',
      config: { enabled: true },
      fixture: { MODE: 'error', FAIL_FIRST: 1 },
      summarizer: 'minimax-cn/pi-compaction-conversation \\(anthropic-messages\\)',
      why: 'the summarizer reported an error \\(Summarization failed: fixture summarizer is unavailable\\)',
      requests: 1,
    },
  ];

  for (const shape of cases) {
    const run = runCompaction({
      name: `announce-${shape.name}-`,
      config: shape.config,
      fixture: shape.fixture ?? {},
      turns: 30,
      hold: true,
      script: statusScript,
    });
    assert.equal(run.report.error, undefined, run.report.error);
    assert.equal(summarizationRecords(run.records).length, shape.requests + 1, `${shape.name}: our requests, then stock Pi's`);

    assertAnnounced(run, { summarizer: shape.summarizer, why: shape.why });
    assertPaintedAfterTheRepaint(run);

    const persisted = persistedCompactions(run.session.file);
    assert.equal(persisted.length, 1, shape.name);
    assert.equal(persisted[0].fromHook ?? false, false, `${shape.name}: the compaction is host-originated`);
    assertNoPartialPersisted(run);

    // The record survives the run and is readable from the package's own status view afterwards.
    const entries = readFileSync(run.session.file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const recorded = entries.filter((entry) => entry.type === 'custom' && entry.customType === 'pi-compaction-degradation');
    assert.equal(recorded.length, 1, `${shape.name}: the degradation is recorded in the session`);
    assert.match(run.plain, /Last degradation: summarizer /, `${shape.name}: the status view reports it`);
  }
});

test('a second compaction does not inherit the first one\'s file lists', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'twice-',
    config: { enabled: true, keptWindowTokens: 4_000 },
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
    config: { enabled: true },
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
    config: { enabled: true },
    turns: 30,
    script: [
      { expect: READY, send: '/compaction\r' },
      { expect: 'Host seam:', send: '/compaction model pi-compaction-fixture-pool/pool-summarizer\r' },
      { expect: 'openai-responses', send: '/compaction model conversation\r' },
      { expect: 'pi-compaction-conversation', send: '/compaction thinking high\r' },
      { expect: 'Thinking: high', send: '/compaction window 12000\r' },
      { expect: 'Kept window: 12000 tokens', send: '/compaction thinking nonsense\r' },
      { expect: 'nothing changed', send: '/compaction disable\r' },
      { expect: 'Enabled: no', send: '/compact\r' },
      { expect: 'Compacted from', send: '/compaction-probe\r' },
    ],
  });
  assert.equal(run.report.error, undefined, run.report.error);

  assert.match(run.plain, /Summarizer model: minimax-cn\/pi-compaction-conversation \(anthropic-messages\)/);
  assert.match(run.plain, /Thinking: medium/);
  assert.match(run.plain, /Kept window: 16000 tokens/);
  assert.match(run.plain, /Summary length: not bounded by this package/);
  assert.match(run.plain, /Enabled: yes/);
  assert.match(run.plain, /Host seam: ok .*compact\(\) arity 12/);
  assert.match(run.plain, /Error: pi-compaction: nothing changed; thinking must be/);

  const persisted = JSON.parse(readFileSync(join(run.agent, 'extensions/pi-compaction/config.json'), 'utf8'));
  assert.deepEqual(persisted, {
    enabled: false,
    summarizerModel: null,
    thinking: 'high',
    keptWindowTokens: 12_000,
  });

  // `/compaction` must not shadow the host's own `/compact`, which still compacts on its own.
  const compactions = persistedCompactions(run.session.file);
  assert.equal(compactions.length, 1, 'the host\'s /compact must still have compacted');
  assert.equal(compactions[0].fromHook ?? false, false, 'with the package disabled, that compaction is stock');

  const names = run.report.commands.map((command) => command.name);
  assert.ok(names.includes('compaction'));
  assert.equal(run.report.commands.find((command) => command.name === 'compaction').source, 'extension');
});

test('acceptance: the kept window follows our own target and nothing is lost', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'acceptance-',
    config: { enabled: true, keptWindowTokens: DEFAULT_KEPT_WINDOW_TOKENS },
    turns: 40,
  });
  const [compaction] = run.report.compactions;
  assert.equal(compaction.ok, true, compaction.error);
  const persisted = persistedCompactions(run.session.file)[0];
  assert.equal(persisted.fromHook, true);

  // The summary is the host's, whole, at whatever length the model produced — this package does not
  // bound it and does not check it. What it does control is the cut point.
  assert.ok(persisted.summary.length > 0);
  assertNothingLost(run);
  console.log(
    `acceptance: summary ${Math.ceil(persisted.summary.length / 4)} tokens, `
    + `${persisted.summary.length} chars; no output ceiling was sent `
    + `(synthetic profile's own prompt: ${run.report.systemPromptTokens} tokens, tools: ${run.report.activeTools.join(', ')})`,
  );
});
