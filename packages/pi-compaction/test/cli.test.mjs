import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateTokens } from '@earendil-works/pi-coding-agent';
import { MAX_FILE_LIST_ENTRIES } from '../src/preparation.ts';
import { DEFAULT_KEPT_WINDOW_TOKENS } from '../src/config.ts';
import { persistedCompactions, READY, runCompaction, statusScript, summarizationRecords } from './run-compaction.mjs';

const CONVERSATION_MODEL = 'minimax-cn/pi-compaction-conversation';
/** A summarizer and a fallback on two different providers, so no assertion can confuse them. */
const PRIMARY = 'minimax-cn/minimax-M3.1-Flash';
const FALLBACK = 'pi-compaction-fixture-pool/pool-summarizer';
/** The text an aborted response carries. Nothing on any path may put it in the session. */
const PARTIAL = 'PARTIAL-SUMMARY-MUST-NEVER-BE-PERSISTED';
const HEADLINE = 'degraded — compaction handed back to stock Pi';
const RECOVERED = 'recovered — the fallback summarizer produced the summary';
const DEGRADATION_ENTRY = 'pi-compaction-degradation';
const FALLBACK_ENTRY = 'pi-compaction-fallback';

const markers = (text) => new Set(text?.match(/MARK-[uar]\d+/g) ?? []);
/** What the compaction left verbatim: every projected entry that is not the compaction itself. */
const keptTokens = (report) =>
  report.projection.entries.filter((entry) => entry.type !== 'compaction').reduce((sum, entry) => sum + entry.tokens, 0);

/** Every handback announces to the same standard: which summarizer, why, and what happens now. */
function assertAnnounced(run, { summarizer, why }) {
  assert.match(run.plain, new RegExp(`pi-compaction: ${HEADLINE}`), 'the headline reaches stderr');
  assert.match(run.plain, new RegExp(`Summarizer: ${summarizer}`), 'which summarizer');
  assert.match(run.plain, new RegExp(`Why: ${why}`), 'why it degraded');
  // A handback gives up all three of the things this package controls, and the cut point is the third:
  // returning `undefined` from the hook means the host prepares its own compaction with the host's
  // recent-token setting, so the configured kept-window target never applies.
  assert.match(
    run.plain,
    /Now: stock Pi compacts with the conversation model, the session's own thinking level, and the host's recent-token setting rather than this package's kept-window target/,
  );
  assert.match(run.plain, /The summary length is unaffected/);
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

/** Every custom entry of one type the package wrote into the session. */
function customEntries(run, customType) {
  return readFileSync(run.session.file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'custom' && entry.customType === customType);
}

/** The durable half: a custom session entry, which carries no LLM context, and the status view. */
function assertRecorded(run, { reason, customType = DEGRADATION_ENTRY, attempts = 1 }) {
  const recorded = customEntries(run, customType);
  assert.equal(recorded.length, 1, `one ${customType} entry is recorded in the session`);
  assert.equal(recorded[0].data.attempts.length, attempts, 'every attempt is recorded, in order');
  assert.equal(recorded[0].data.attempts.at(-1).reason, reason);
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

/**
 * The transcript with the PTY driver's own noise removed, whitespace and all.
 *
 * The driver echoes what it sent and the pattern it matched into the same stream the program writes to,
 * and it lands wherever the cursor happens to be — on macOS that is mid-sentence:
 * `Complete it wi PI_DRIVE_MATCHED nothing changed th both aboveTokens`. One long `assert.match` over
 * the raw screen therefore fails for a reason that has nothing to do with this package, and it failed
 * on macOS and passed on ubuntu. So: strip the driver's markers and exactly the strings this test sent
 * or waited for — never a word of the program's own output — and compare without whitespace, which also
 * survives a terminal wrap splitting a word. A refusal that stopped happening still fails, because the
 * fragments asserted on are none of the strings removed here, and the file on disk is checked directly.
 *
 * Do not collapse the assertions below back into one `assert.match` over `run.plain`.
 */
function screen(run, script = []) {
  const bare = (text) => text.replace(/\s+/g, '');
  let text = bare(run.plain.replace(/PI_DRIVE_[A-Z_]+/g, ''));
  for (const step of script) {
    text = text.split(bare(step.send)).join('').split(bare(step.expect)).join('');
  }
  return text;
}

/** Every fragment must be on the screen; short ones, because the driver's echo can land anywhere. */
function assertSaid(run, script, fragments) {
  const shown = screen(run, script);
  for (const fragment of fragments) {
    assert.ok(shown.includes(fragment.replace(/\s+/g, '')), `the run must have said "${fragment}"`);
  }
}

/**
 * Redistilling: the previous summary is only ever merged into, so the one lever this package has that
 * does not damage the current response is the host's own `customInstructions` slot. The tests below
 * read what reached the summarization request, which is where the instruction lands as the host's
 * `Additional focus:` line.
 */
const REDISTILL = { aboveTokens: 4_000, targetTokens: 6_000 };

/**
 * The number the instruction names, measured the way the package measures it.
 *
 * The host's own estimator, over the previous summary **the request carried** — taken from the
 * request's `<previous-summary>` block rather than from the persisted compaction entry, and never
 * re-implemented as `Math.ceil(chars / 4)`. A hand-written estimate is a second copy of a host
 * constant, and a token of drift would fail these tests for a reason that has nothing to do with
 * redistilling. What the assertions still pin independently is the wording: `instructionFor` is a
 * literal, and the estimator itself is covered by `test/redistill.test.mjs` and by the token-seam probe.
 */
const carriedSummary = (record) => record.prompt.match(/<previous-summary>\n([\s\S]*?)\n<\/previous-summary>/)?.[1];
const hostTokens = (summary) =>
  estimateTokens({ role: 'compactionSummary', summary, tokensBefore: 0, timestamp: 0 });
/** The previous summary's size as the request that updates it will measure it. */
const previousTokensIn = (record) => {
  const carried = carriedSummary(record);
  assert.ok(carried !== undefined, 'the request that updates a summary must carry it in <previous-summary> tags');
  return hostTokens(carried);
};

/**
 * The text the host appended as `Additional focus:`.
 *
 * The capture runs to the end of the prompt, not to the end of the line, because the value spans lines
 * by construction: a caller's `/compact <text>` and this package's instruction are joined by a blank
 * line, and a line-bounded capture would return the caller's text alone and quietly drop the assertion
 * that ours follows it.
 *
 * That is only the focus if the host renders the line last, so the placement is checked here instead of
 * assumed: a host that put it before the document would have this capture swallow `<conversation>`,
 * `<previous-summary>` or the turn prefix's `# Instructions`, and no instruction this package sends
 * contains any of those. Both request shapes end with the focus value today.
 */
const focusOf = (record) => {
  const focus = record.prompt.match(/Additional focus: ([\s\S]*)$/)?.[1].trim();
  if (focus !== undefined) {
    assert.doesNotMatch(
      focus,
      /<conversation>|<\/previous-summary>|# Instructions/,
      'the Additional focus value must be the last thing in the prompt, not a request document',
    );
  }
  return focus;
};
/** The fixed template, written out here rather than imported, so the test is not its own oracle. */
const instructionFor = (previousTokens, targetTokens) =>
  `The previous summary is ${previousTokens} tokens and the merged summary should stay under ${targetTokens}. `
  + 'Keep every goal, constraint, decision with its rationale, blocker, open question and next step '
  + 'that is still true. Drop an entry when a later entry supersedes it, and drop detail about work '
  + 'that is finished and no longer referenced. Do not append a changelog and do not add a history section.';

test('redistill off, null or half-configured leaves the fifth argument exactly as it was', { timeout: 600_000 }, () => {
  // Above the sum of the four runs' own 120 s driveHost budgets: a run that hangs fails on
  // runCompaction's own PI_DRIVE_TIMEOUT assertion, and this cap must not kill it first and make the
  // break read as flakiness.
  const user = 'focus on the failing test; keep the port number';
  for (const redistill of [undefined, null, { aboveTokens: 4_000 }, { targetTokens: 6_000 }]) {
    const run = runCompaction({
      name: 'redistill-off-',
      config: { enabled: true, ...(redistill === undefined ? {} : { redistill }) },
      // Two rounds, so the second one has a previous summary to re-distil and still must not. The
      // caller's own text is what makes "unchanged" observable: without it every record would
      // legitimately carry no `Additional focus:` line, and a regression that dropped the fifth
      // argument whenever redistill is off would pass.
      probe: { ROUNDS: 2, FOLLOWUP: 24_000, INSTRUCTIONS: user },
      fixture: { SUMMARY: 5_000 },
      turns: 40,
    });
    assert.equal(run.report.error, undefined, run.report.error);
    const records = summarizationRecords(run.records);
    assert.equal(records.length, 2, JSON.stringify(redistill));
    for (const record of records) {
      assert.equal(focusOf(record), user, `${JSON.stringify(redistill)}: the caller's text, unchanged`);
      assert.doesNotMatch(record.prompt, /The previous summary is \d+ tokens/, `${JSON.stringify(redistill)}: nothing appended`);
    }
    assert.deepEqual(persistedCompactions(run.session.file).map((entry) => entry.fromHook), [true, true]);
  }
});

test('a previous summary at or above the threshold is asked to re-distil, and the first compaction is not', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'redistill-',
    config: { enabled: true, redistill: REDISTILL },
    fixture: { SUMMARY: 5_000 },
    probe: { ROUNDS: 2, FOLLOWUP: 24_000 },
    turns: 40,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  const records = summarizationRecords(run.records);
  assert.equal(records.length, 2);

  // The first compaction has nothing to re-distil.
  assert.equal(focusOf(records[0]), undefined, 'the first compaction must inject nothing');

  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 2);
  const previous = previousTokensIn(records[1]);
  assert.ok(previous >= REDISTILL.aboveTokens, `the previous summary was ${previous} tokens`);
  assert.equal(focusOf(records[1]), instructionFor(previous, REDISTILL.targetTokens));
  // Asking is all it does: the summary is still the host's, whole, and this package sent no ceiling.
  assert.equal(records[1].options.maxTokens, undefined);
  assert.deepEqual(persisted.map((entry) => entry.fromHook), [true, true]);
});

test('a previous summary below the threshold injects nothing', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'redistill-small-',
    config: { enabled: true, redistill: REDISTILL },
    // The default fixture summary is 200 tokens, far below the 4,000-token threshold.
    probe: { ROUNDS: 2, FOLLOWUP: 24_000 },
    turns: 40,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  const records = summarizationRecords(run.records);
  assert.equal(records.length, 2);
  const previous = previousTokensIn(records[1]);
  assert.ok(previous < REDISTILL.aboveTokens, `the previous summary was ${previous} tokens`);
  for (const record of records) {
    assert.equal(focusOf(record), undefined);
  }
});

test('a split turn is left alone: one instruction cannot serve both of its requests', { timeout: 180_000 }, () => {
  const user = 'focus on the failing test; keep the port number';
  const run = runCompaction({
    name: 'redistill-split-',
    // A kept window larger than the follow-up turn puts the second round's cut point inside one of
    // the entries the first round kept, which is what makes that round a split turn.
    config: { enabled: true, keptWindowTokens: 34_000, redistill: REDISTILL },
    fixture: { SUMMARY: 5_000 },
    probe: { ROUNDS: 2, FOLLOWUP: 24_000, INSTRUCTIONS: user },
    turns: 40,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  const records = summarizationRecords(run.records);
  // The first round is one request; the second is a split turn, which is two.
  assert.equal(records.length, 3);
  assert.equal(records[0].prompt.includes('<previous-summary>'), false, 'the first round has no previous summary');
  assert.equal(records[1].prompt.includes('<previous-summary>'), true, 'the second round\'s history request updates one');
  assert.equal(records[2].prompt.includes('# Instructions'), true, 'and its third request is the turn prefix');

  // The gate is what suppressed it, not a small summary: this one is over the threshold.
  const previous = previousTokensIn(records[1]);
  assert.ok(previous >= REDISTILL.aboveTokens, `the previous summary was ${previous} tokens`);

  // The host applies one custom-instruction value to both requests, and the turn-prefix request's
  // document is only the current turn: no previous summary, and its output is concatenated onto the
  // merged summary rather than being one. The instruction's premise would be false there and its
  // pruning clause would aim at the newest range, so nothing of ours is asked for.
  assert.equal(focusOf(records[1]), user, 'the history request carries only the caller\'s own text');
  assert.equal(focusOf(records[2]), user, 'and so does the turn prefix');
  assert.equal(focusOf(records[0]), user, 'the first round never had a previous summary to re-distil');
  assert.doesNotMatch(records[1].prompt, /The previous summary is \d+ tokens/, 'no instruction on a split turn');
  assert.doesNotMatch(records[2].prompt, /The previous summary is \d+ tokens/, 'none on its turn prefix either');
});

test("a user's own /compact text is kept verbatim and ours is appended to it", { timeout: 180_000 }, () => {
  const user = 'focus on the failing test; keep the port number';
  const run = runCompaction({
    name: 'redistill-user-text-',
    config: { enabled: true, redistill: REDISTILL },
    fixture: { SUMMARY: 5_000 },
    probe: { ROUNDS: 2, FOLLOWUP: 24_000, INSTRUCTIONS: user },
    turns: 40,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  const records = summarizationRecords(run.records);
  assert.equal(records.length, 2);

  // The first compaction has nothing to re-distil, so the user's text is the whole of the slot.
  assert.equal(focusOf(records[0]), user, "the user's text reaches the request unmodified");

  const previous = previousTokensIn(records[1]);
  const focus = focusOf(records[1]);
  assert.ok(focus.startsWith(user), `the user's text must come first and unmodified:\n${focus}`);
  // Ours is appended after it, never woven into it.
  assert.equal(focus, `${user}\n\n${instructionFor(previous, REDISTILL.targetTokens)}`);
  assert.equal(focus.indexOf(user), 0, 'and the user text is at the start of the slot');
});

test('a redistilled request that comes back partial is still never persisted', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'redistill-partial-',
    config: { enabled: true, redistill: REDISTILL },
    // Only the second summarization request fails, which is the redistilled one: the first round has
    // to succeed for there to be a previous summary to re-distil.
    fixture: { SUMMARY: 5_000, STOP_REASON: 'aborted', FAIL_ONLY: 2 },
    probe: { ROUNDS: 2, FOLLOWUP: 24_000 },
    turns: 40,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  const records = summarizationRecords(run.records);
  assert.equal(records.length, 3, 'our two rounds, then stock Pi\'s own request after the handback');
  assert.equal(records[1].stopReason, 'aborted', 'the redistilled request is the partial one');
  assert.ok(focusOf(records[1])?.startsWith('The previous summary is '), 'and it is a redistilled request');
  assert.equal(records[2].stopReason, undefined, "stock Pi's own request is the one that compacted");

  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].fromHook, true, 'the first round is ours');
  assert.equal(persisted[1].fromHook ?? false, false, 'the refused round is the host\'s');
  assertNoPartialPersisted(run);
  assert.match(run.plain, /Why: the summarizer's response stopped with "aborted"/);
  // The handback says what it gives up, and with redistilling configured it must not also claim the
  // summary's length is unaffected. Fragments rather than one long match: see `screen` above.
  assertSaid(run, [], [
    'a redistilling instruction was configured and stock Pi does not ask for it',
    'the summary is a union again and nothing requests a size',
  ]);
  assert.ok(
    !screen(run).includes('Thesummarylengthisunaffected'),
    'with redistilling in force the announcement must not claim the length is unaffected',
  );
});

test('/compaction reports whether redistilling is on, and at what thresholds', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'redistill-status-',
    config: { enabled: true, redistill: { aboveTokens: 4_000, targetTokens: 6_000 } },
    turns: 30,
    hold: true,
    script: statusScript,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  assert.match(
    run.plain,
    /Redistilling: on — asks for a fixed point once the previous summary reaches 4000 tokens, naming 6000 as the target \(a request, not a ceiling\)/,
  );
});

test('/compaction refuses a change that would erase a half-written redistill', { timeout: 180_000 }, () => {
  // `redistill` is file-only, so a save that dropped the half-written value would destroy something
  // the command surface cannot restore. The refusal has to reach the user, not throw out of the
  // command handler — and the file itself is the assertion that cannot be talked away.
  const script = [
    { expect: READY, send: '/compaction thinking high\r' },
    { expect: 'nothing changed', send: '/compaction-probe\r' },
  ];
  const run = runCompaction({
    name: 'redistill-partial-save-',
    config: { enabled: true, thinking: 'medium', redistill: { aboveTokens: 4_000 } },
    turns: 30,
    script,
    // The script's second step waits for the refusal before driving the probe, so a refusal that
    // stopped happening is caught by `runCompaction`'s own PI_DRIVE_TIMEOUT assertion. Thirty seconds
    // is ample for this run and keeps that failure fast instead of eating the default 120 s budget.
    timeoutSeconds: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  // Split into fragments on purpose: see `screen` above. Each one is a fact the refusal establishes,
  // and none of them is a string the driver echoes, so a refusal that disappeared fails all of them.
  assertSaid(run, script, [
    'refusing to rewrite',            // a refusal happened at all
    'config.json: it carries a redistill', // and it is about this file's redistill
    'cannot be set from /compaction', // naming why the command cannot fix it
    'aboveTokens',                    // and both fields it tells the user to complete
    'targetTokens',
  ]);

  // The file is the proof: nothing was written, and the change was not half-applied.
  const onDisk = JSON.parse(readFileSync(join(run.agent, 'extensions/pi-compaction/config.json'), 'utf8'));
  assert.deepEqual(onDisk.redistill, { aboveTokens: 4_000 }, 'the half-written value is still there');
  assert.equal(onDisk.thinking, 'medium', 'and the refused change was not half-applied');
  assert.equal(persistedCompactions(run.session.file)[0].fromHook, true, 'compaction still ran, with redistill off');
});

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

test('a response with no stop reason is refused, and the reason says so', { timeout: 180_000 }, () => {
  // An unproven summary is not a complete one. The host returns a response it does not recognise
  // unchanged, so a missing stop reason has to be refused rather than assumed clean — and the
  // announcement has to describe that, rather than quoting the string "undefined" at the user.
  const run = runCompaction({
    name: 'no-stop-reason-',
    config: { enabled: true },
    fixture: { MODE: 'no-stop-reason', FAIL_FIRST: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction that reached the session is the host\'s');
  assertNoPartialPersisted(run);

  assert.match(run.plain, /Why: the summarizer's response carried no stop reason/);
  assert.doesNotMatch(run.plain, /stopped with "undefined"/, 'and never reports a missing value as a value');
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

  // A split turn makes two summarization requests through our stream function and only the first
  // carries the partial text. Order is what identifies them: our two come first, then stock Pi's own
  // request after the handback. A weaker assertion here would not distinguish a refusal from a
  // summary that was never partial to begin with.
  const records = summarizationRecords(run.records);
  assert.equal(records.length, 3, 'our split turn made two requests, then stock Pi made one');
  assert.equal(records[0].stopReason, 'aborted', 'the first response carries the partial text');
  assert.equal(records[1].stopReason, undefined, 'the second is clean — all a last-response-only check would see');
  assert.equal(records[2].stopReason, undefined, "and stock Pi's own request is the one that compacted");

  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction that reached the session is the host\'s');
  assertNoPartialPersisted(run);
  // The refusal is the guarantee: without it the concatenated summary would have been ours.
  assert.match(run.plain, /Why: the summarizer's response stopped with "aborted"/);
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
    const recorded = customEntries(run, DEGRADATION_ENTRY);
    assert.equal(recorded.length, 1, `${shape.name}: the degradation is recorded in the session`);
    assert.match(run.plain, /Last degradation: summarizer /, `${shape.name}: the status view reports it`);
  }
});

const modelsRequested = (run) => summarizationRecords(run.records).map((record) => record.model);

/**
 * A fallback that produced the summary: this package's own compaction reached the session, the
 * announcement says a fallback ran rather than claiming a handback, and the durable record is the
 * fallback entry rather than the degradation one.
 */
function assertRecovered(run, { after }) {
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook, true, "the fallback's summary is this package's to persist");
  assert.match(run.plain, new RegExp(RECOVERED), 'the announcement says the fallback ran');
  assert.doesNotMatch(run.plain, new RegExp(HEADLINE), 'and never claims a handback');
  assert.doesNotMatch(run.plain, /Earlier:/, 'Why: already names the failed attempt');
  assert.match(run.plain, new RegExp(`Summarizer: ${after.summarizer}`), 'which model actually ran');
  assert.match(run.plain, new RegExp(`Why: .*${after.why}`), 'and why the primary did not');
  assertRecorded(run, { customType: FALLBACK_ENTRY, attempts: 2, reason: undefined });
  assert.deepEqual(customEntries(run, DEGRADATION_ENTRY), [], 'a fallback that ran is not a degradation');
}

test('no fallback model leaves the handback path exactly as it was', { timeout: 180_000 }, () => {
  // The default has to be the released behaviour, announcement included: one attempt, stock Pi
  // after it, and no wording that only makes sense once a second model is configured.
  const run = runCompaction({
    name: 'no-fallback-',
    config: { enabled: true, summarizerModel: PRIMARY, fallbackModel: null },
    fixture: { MODE: 'error', FAIL_FIRST: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  assert.deepEqual(modelsRequested(run), [PRIMARY, CONVERSATION_MODEL], 'our attempt, then stock Pi\'s own');
  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction that reached the session is the host\'s');

  const reason = 'the summarizer reported an error \\(Summarization failed: fixture summarizer is unavailable\\)';
  assertAnnounced(run, { summarizer: 'minimax-cn/minimax-M3.1-Flash \\(anthropic-messages\\)', why: reason });
  assertRecorded(run, { reason: reason.replace(/\\([()])/g, '$1'), attempts: 1 });
  assert.doesNotMatch(run.plain, new RegExp(RECOVERED));
  assert.doesNotMatch(run.plain, /Earlier:/);
});

test('a summarizer this host does not offer falls back, and the fallback\'s summary is persisted', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'fallback-absent-',
    config: { enabled: true, summarizerModel: 'pi-compaction-fixture-pool/absent', fallbackModel: FALLBACK },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  // No request is made for a model this host does not have, so the only one is the fallback's.
  assert.deepEqual(modelsRequested(run), [FALLBACK]);
  assertRecovered(run, {
    after: {
      summarizer: 'pi-compaction-fixture-pool/pool-summarizer \\(openai-responses\\)',
      why: 'this host does not offer summarizer model pi-compaction-fixture-pool/absent',
    },
  });
  const [primary] = customEntries(run, FALLBACK_ENTRY)[0].data.attempts;
  assert.equal(primary.summarizer, 'pi-compaction-fixture-pool/absent', 'the attempt that never ran is still named');
  assertNothingLost(run);
});

test('a summarizer with no configured credentials falls back', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'fallback-noauth-',
    config: {
      enabled: true,
      summarizerModel: 'pi-compaction-fixture-noauth/unauthenticated-summarizer',
      fallbackModel: FALLBACK,
    },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  assert.deepEqual(modelsRequested(run), [FALLBACK], 'an unauthenticated model is never requested');
  assertRecovered(run, {
    after: {
      summarizer: 'pi-compaction-fixture-pool/pool-summarizer \\(openai-responses\\)',
      why: 'the host has no configured credentials for it',
    },
  });
});

test('a summarizer that reports an error falls back', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'fallback-error-',
    config: { enabled: true, summarizerModel: PRIMARY, fallbackModel: FALLBACK },
    fixture: { MODE: 'error', FAIL_FIRST: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  assert.deepEqual(modelsRequested(run), [PRIMARY, FALLBACK]);
  assertRecovered(run, {
    after: {
      summarizer: 'pi-compaction-fixture-pool/pool-summarizer \\(openai-responses\\)',
      why: 'Summarization failed: fixture summarizer is unavailable',
    },
  });
});

test('a partial response from the primary falls back, and the fallback\'s whole summary is persisted', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'fallback-partial-',
    config: { enabled: true, summarizerModel: PRIMARY, fallbackModel: FALLBACK },
    fixture: { STOP_REASON: 'aborted', FAIL_FIRST: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  assert.deepEqual(modelsRequested(run), [PRIMARY, FALLBACK]);
  assertRecovered(run, {
    after: {
      summarizer: 'pi-compaction-fixture-pool/pool-summarizer \\(openai-responses\\)',
      why: 'the summarizer\'s response stopped with "aborted" instead of finishing',
    },
  });
  // The partial text the primary produced is nowhere, even though its attempt was refused rather
  // than thrown away: a refused attempt's text must not reach the session from any path.
  assertNoPartialPersisted(run);
});

test('a partial response from the fallback is refused too, and hands back', { timeout: 180_000 }, () => {
  // The partial-summary guarantee is the package's, not the primary model's. A fallback that returns
  // a partial response is refused exactly as a primary would be, and then compaction hands back.
  const run = runCompaction({
    name: 'fallback-partial-too-',
    config: { enabled: true, summarizerModel: PRIMARY, fallbackModel: FALLBACK },
    fixture: { STOP_REASON: 'aborted', FAIL_FIRST: 2 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  assert.deepEqual(modelsRequested(run), [PRIMARY, FALLBACK, CONVERSATION_MODEL], 'both of ours, then stock Pi\'s');

  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction that reached the session is the host\'s');
  assertNoPartialPersisted(run);

  const reason = 'the summarizer\'s response stopped with "aborted" instead of finishing, so the summary may be partial';
  assertAnnounced(run, {
    summarizer: 'pi-compaction-fixture-pool/pool-summarizer \\(openai-responses\\)',
    why: reason,
  });
  assertPaintedAfterTheRepaint(run);
  assertRecorded(run, { reason, attempts: 2 });
  assert.deepEqual(customEntries(run, FALLBACK_ENTRY), [], 'a refused fallback is not a recovery');
});

test('both attempts failing hands back, and the record names both of them and both reasons', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'fallback-both-',
    config: {
      enabled: true,
      summarizerModel: 'pi-compaction-fixture-pool/absent',
      fallbackModel: 'pi-compaction-fixture-noauth/unauthenticated-summarizer',
    },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  // Neither model could be requested, so the only summarization request is the host's own.
  assert.deepEqual(modelsRequested(run), [CONVERSATION_MODEL]);

  const persisted = persistedCompactions(run.session.file);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].fromHook ?? false, false);

  const reason = 'the host has no configured credentials for it';
  assertAnnounced(run, {
    summarizer: 'pi-compaction-fixture-noauth/unauthenticated-summarizer \\(anthropic-messages\\)',
    why: reason,
  });
  assert.match(run.plain, /Earlier: pi-compaction-fixture-pool\/absent — this host does not offer summarizer model pi-compaction-fixture-pool\/absent/);

  const [record] = customEntries(run, DEGRADATION_ENTRY);
  assert.equal(record.data.attempts.length, 2);
  assert.deepEqual(record.data.attempts.map((attempt) => attempt.summarizer), [
    'pi-compaction-fixture-pool/absent',
    'pi-compaction-fixture-noauth/unauthenticated-summarizer (anthropic-messages)',
  ]);
  assert.match(record.data.attempts[0].reason, /this host does not offer/);
  assert.equal(record.data.attempts[1].reason, reason);
  assert.deepEqual(customEntries(run, FALLBACK_ENTRY), []);
});

test('a cancellation never reaches the fallback stream function', { timeout: 180_000 }, () => {
  // The primary returns a response the package would otherwise refuse — so the fallback is exactly
  // one branch away — and the user cancels on that response. Starting the fallback here would be a
  // fresh request behind their back, which is the one thing a cancellation must never do.
  //
  // This is the real-host half of the guarantee: nothing is persisted and no fallback request
  // reaches a provider. Which of the two refusals did it — this package's own guard or the host's,
  // which will not start a request on an aborted signal — is what `index.test.mjs` pins.
  const run = runCompaction({
    name: 'cancel-fallback-',
    config: { enabled: true, summarizerModel: PRIMARY, fallbackModel: FALLBACK },
    fixture: { STOP_REASON: 'aborted', ABORT_AFTER_SUMMARIZE: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  const records = summarizationRecords(run.records);
  assert.equal(records.length, 1, 'one request, and no fallback behind the user');
  assert.equal(records[0].model, PRIMARY);
  assert.deepEqual(records.filter((record) => record.model === FALLBACK), [],
    'the fallback stream function was never called');
  assert.deepEqual(persistedCompactions(run.session.file), [], 'nothing was persisted');
  assert.doesNotMatch(run.plain, new RegExp(HEADLINE), 'a cancellation is not a degradation');
  assert.doesNotMatch(run.plain, new RegExp(RECOVERED), 'and not a recovery either');
  assert.deepEqual(customEntries(run, DEGRADATION_ENTRY), []);
  assert.deepEqual(customEntries(run, FALLBACK_ENTRY), []);
  assertNoPartialPersisted(run);
});

test('the fallback attempt summarises the same range as the primary', { timeout: 180_000 }, () => {
  // Same kept window, and — because both of these models support the configured level — the same
  // thinking level too. A fallback is a different model, not a different compaction: the two requests
  // summarise byte-identical input, which is the only way to prove the cut point did not move
  // between them. The level is clamped per model, so it is *not* guaranteed to match; the clamp case
  // has its own test below.
  const run = runCompaction({
    name: 'fallback-same-',
    config: { enabled: true, summarizerModel: PRIMARY, fallbackModel: FALLBACK, thinking: 'low' },
    fixture: { MODE: 'error', FAIL_FIRST: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);
  const [first, second] = summarizationRecords(run.records);
  assert.equal(first.model, PRIMARY);
  assert.equal(second.model, FALLBACK);
  assert.equal(first.prompt, second.prompt, 'both attempts summarise the same range');
  assert.equal(first.options.reasoning, 'low');
  assert.equal(second.options.reasoning, 'low', 'both models support the configured level here');
  assert.equal(second.options.maxTokens, undefined, 'and no output ceiling either');
  assert.equal(persistedCompactions(run.session.file)[0].fromHook, true);
  assertNothingLost(run);
});

test('a fallback identical to the summarizer is refused, and never offered', { timeout: 180_000 }, () => {
  // Refusing the pairing is a whole-file rejection, so all three surfaces have to refuse it: the
  // file, the command, and the status view — which must not present the summarizer as an available
  // fallback for itself.
  const run = runCompaction({
    name: 'self-fallback-',
    config: { enabled: true, summarizerModel: PRIMARY, fallbackModel: PRIMARY },
    turns: 30,
    script: [
      { expect: READY, send: '/compaction\r' },
      { expect: 'Host seam:', send: `/compaction fallback ${PRIMARY}\r` },
      { expect: 'Fallback model:', send: `/compaction model ${PRIMARY}\r` },
      { expect: 'nothing changed; fallbackModel must be a different model', send: `/compaction fallback ${FALLBACK}\r` },
      { expect: 'openai-responses', send: '/compaction-probe\r' },
      { expect: 'Compacted from' },
    ],
  });
  assert.equal(run.report.error, undefined, run.report.error);

  // The file as written is rejected whole, so the package reports the diagnostic and stays inert
  // rather than offering the summarizer as its own fallback.
  assert.match(run.plain, /Config rejected: .*fallbackModel must be a different model from summarizerModel/);
  assert.match(run.plain, /compaction stays stock Pi/);
  // The first status view the user sees — the one rendered against the rejected file — must not
  // offer the summarizer as its own fallback. Later views legitimately show an accepted value.
  const firstFallbackLine = run.plain.indexOf('Fallback model:');
  assert.ok(firstFallbackLine >= 0, 'the status view reports a fallback');
  assert.match(
    run.plain.slice(firstFallbackLine, firstFallbackLine + 40),
    /^Fallback model: none/,
    'a self-fallback is never offered as available',
  );

  // The command refuses the pairing too, from either verb: `fallback` cannot be set to the current
  // summarizer, and `model` cannot be set to the current fallback.
  assert.match(run.plain, /Error: pi-compaction: nothing changed; fallbackModel must be a different model from summarizerModel/);
  const persisted = JSON.parse(readFileSync(join(run.agent, 'extensions/pi-compaction/config.json'), 'utf8'));
  assert.deepEqual(persisted, {
    enabled: false,
    summarizerModel: null,
    fallbackModel: FALLBACK,
    thinking: 'medium',
    keptWindowTokens: 16_000,
  }, 'the refused step changed nothing; the accepted one wrote the file');
});

test('a fallback that cannot honour the configured thinking level is reported honestly', { timeout: 180_000 }, () => {
  // The level is clamped against the model that runs, so the fallback here gets a different answer
  // than the primary would have. An announcement claiming "the same thinking level" would be the
  // opposite of what happened, on the one line a reader trusts most.
  const run = runCompaction({
    name: 'fallback-clamp-',
    config: {
      enabled: true,
      summarizerModel: PRIMARY,
      // `medium` is unsupported on this model, so the host's clamp prefers a higher one.
      fallbackModel: 'minimax-cn/minimax-M3.1-Flash-no-medium',
      thinking: 'medium',
    },
    fixture: { MODE: 'error', FAIL_FIRST: 1 },
    turns: 30,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  const [first, second] = summarizationRecords(run.records);
  assert.equal(first.options.reasoning, 'medium', 'the primary would have run at the configured level');
  assert.equal(second.options.reasoning, 'high', 'the fallback really did run at a different one');

  assert.match(run.plain, /at thinking level high \(clamped from medium; the level is clamped per model\)/);
  assert.doesNotMatch(run.plain, /same thinking level/, 'and the announcement never claims otherwise');

  // The record carries the fact, not just the prose.
  const [record] = customEntries(run, FALLBACK_ENTRY);
  assert.deepEqual(record.data.attempts[1].thinking, { level: 'high', clampedFrom: 'medium' });
  assert.equal(record.data.attempts[0].thinking, undefined, 'an attempt that never ran has no level');
  assert.equal(persistedCompactions(run.session.file)[0].fromHook, true);
});

test('a degradation recorded by 0.2.1 is still reported after a resume', { timeout: 180_000 }, () => {
  // 0.2.1 recorded one attempt as `{ summarizer, reason }`. A session outlives the version that
  // compacted it, and the custom entry is the half of the announcement that survives a restart — so
  // resuming a session that carries one has to keep reporting the handback it recorded. Skipping the
  // entry would report `none in this session` over a file that plainly contains a degradation.
  const legacy = {
    summarizer: 'legacy-provider/legacy-summarizer (anthropic-messages)',
    reason: 'the summarizer reported an error (503 model_unavailable)',
  };
  const run = runCompaction({
    name: 'legacy-record-',
    // Inert, so the run adds no record of its own and the legacy entry stays the most recent one.
    config: { enabled: false },
    turns: 30,
    decorate: (session) => session.appendCustomEntry(DEGRADATION_ENTRY, legacy),
    script: [
      { expect: READY, send: '/compaction\r' },
      { expect: 'Host seam:', send: '/compaction-probe\r' },
      { expect: 'Compacted from' },
    ],
  });
  assert.equal(run.report.error, undefined, run.report.error);

  assert.match(
    run.plain,
    /Last degradation: summarizer legacy-provider\/legacy-summarizer \(anthropic-messages\) — the summarizer reported an error \(503 model_unavailable\)/,
  );
  assert.doesNotMatch(run.plain, /Last degradation: none in this session/, 'the recorded handback is not reported as absent');

  // The entry itself is untouched on disk: reading it is a read, not a rewrite.
  const [entry] = customEntries(run, DEGRADATION_ENTRY);
  assert.deepEqual(entry.data, legacy, 'the legacy entry is read as written');
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
  assert.match(run.plain, /Redistilling: off/);
  assert.match(run.plain, /Summary length: not bounded by this package/);
  assert.match(run.plain, /Enabled: yes/);
  assert.match(run.plain, /Host seam: ok .*compact\(\) arity 12/);
  assert.match(run.plain, /Error: pi-compaction: nothing changed; thinking must be/);

  const persisted = JSON.parse(readFileSync(join(run.agent, 'extensions/pi-compaction/config.json'), 'utf8'));
  // No `redistill` key at all: an off value is absent rather than null, because 0.2.x rejects a file
  // carrying a field it does not know — and rejects the whole file, not the key.
  assert.deepEqual(persisted, {
    enabled: false,
    summarizerModel: null,
    fallbackModel: null,
    thinking: 'high',
    keptWindowTokens: 12_000,
  });
  assert.equal('redistill' in persisted, false);

  // `/compaction` must not shadow the host's own `/compact`, which still compacts on its own.
  const compactions = persistedCompactions(run.session.file);
  assert.equal(compactions.length, 1, 'the host\'s /compact must still have compacted');
  assert.equal(compactions[0].fromHook ?? false, false, 'with the package disabled, that compaction is stock');

  const names = run.report.commands.map((command) => command.name);
  assert.ok(names.includes('compaction'));
  assert.equal(run.report.commands.find((command) => command.name === 'compaction').source, 'extension');
});

test('the fallback verb sets one model, and the status view says what this host can run', { timeout: 180_000 }, () => {
  const run = runCompaction({
    name: 'command-fallback-',
    config: {
      enabled: true,
      summarizerModel: PRIMARY,
      fallbackModel: 'pi-compaction-fixture-noauth/unauthenticated-summarizer',
    },
    turns: 30,
    script: [
      { expect: READY, send: '/compaction\r' },
      { expect: 'Host seam:', send: '/compaction fallback\r' },
      { expect: 'usage: /compaction fallback provider/model', send: '/compaction fallback no-slash\r' },
      { expect: 'nothing changed; fallbackModel must be', send: `/compaction fallback ${FALLBACK}\r` },
      { expect: 'openai-responses', send: '/compaction fallback none\r' },
      { expect: 'Fallback model: none', send: '/compaction fallback pi-compaction-fixture-pool/absent\r' },
      { expect: 'not available on this host', send: '/compaction fallback conversation\r' },
      { expect: 'Fallback model: none', send: '/compaction-probe\r' },
      { expect: 'Compacted from' },
    ],
  });
  assert.equal(run.report.error, undefined, run.report.error);

  // The starting configuration: a fallback this host offers but has no credentials for, which is
  // exactly what a status view has to say before the next compaction rather than after it.
  assert.match(run.plain, /Fallback model: pi-compaction-fixture-noauth\/unauthenticated-summarizer \(anthropic-messages\) — no configured credentials on this host/);
  // Usage and a rejected id both leave the file alone.
  assert.match(run.plain, /Error: pi-compaction: nothing changed; fallbackModel must be/);
  // A model this host does not offer at all.
  assert.match(run.plain, /Fallback model: pi-compaction-fixture-pool\/absent — not available on this host/);
  // And one it offers with credentials, which is the line that carries no caveat.
  assert.match(run.plain, /Fallback model: pi-compaction-fixture-pool\/pool-summarizer \(openai-responses\)/);
  assert.doesNotMatch(run.plain, /pool-summarizer \(openai-responses\) —/);

  const persisted = JSON.parse(readFileSync(join(run.agent, 'extensions/pi-compaction/config.json'), 'utf8'));
  assert.deepEqual(persisted, {
    enabled: true,
    summarizerModel: PRIMARY,
    // `conversation` is the last spelling of none the script sends, and it must not have configured
    // the conversation model as a fallback: the host handback already is that.
    fallbackModel: null,
    thinking: 'medium',
    keptWindowTokens: 16_000,
  });
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

  // The cut point is one of the three things this package still controls and the only one with a
  // number attached, so it is asserted rather than described. `findCutPoint` walks back until the
  // target is reached and then snaps to a valid boundary, so one oversized entry can carry the window
  // past the target — that overshoot is the allowance.
  const kept = keptTokens(run.report);
  const largestEntry = Math.max(...run.report.projection.entries.map((entry) => entry.tokens));
  assert.ok(kept <= DEFAULT_KEPT_WINDOW_TOKENS + largestEntry, `kept window was ${kept} tokens, target ${DEFAULT_KEPT_WINDOW_TOKENS}`);
  // And it is our target rather than the host's: the host's default is 20,000, so a window at our
  // 16,000 target has to come out below it.
  assert.ok(kept < 20_000, `kept window was ${kept} tokens, not below the host's 20,000 default`);

  // The summary is the host's, whole, at whatever length the model produced — this package does not
  // bound it and does not check it.
  assert.ok(persisted.summary.length > 0);
  assertNothingLost(run);
  console.log(
    `acceptance: summary ${Math.ceil(persisted.summary.length / 4)} tokens, `
    + `${persisted.summary.length} chars; no output ceiling was sent `
    + `(synthetic profile's own prompt: ${run.report.systemPromptTokens} tokens, tools: ${run.report.activeTools.join(', ')})`,
  );
});
