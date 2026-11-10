import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_NEVER_PRUNE } from '../src/config.ts';
import { ARGUMENT_DIGEST_CHARS, CACHE_TTL_FALLBACK_MS, PLACEHOLDER_EXCERPT_CHARS } from '../src/prune.ts';
import { contextEdits, fileEntries, READY, requests, resultEntryFor, resultsFor, runPrune } from './run-prune.mjs';

/** Stock compaction, so nothing but the prune path touches the session. */
const base = (overrides = {}) => ({ enabled: true, preset: 'off', prune: true, pruneWindowTokens: 0, ...overrides });
/** A cold prefix: the request wrote its prompt and read nothing from cache. */
const COLD = { CACHE_WRITE: 50_000 };
/** A warm prefix: the request read it back from cache. */
const WARM = { CACHE_READ: 50_000 };

const SESSION = { turns: 8, turnTokens: 3_600 };
const TIMEOUT = { timeout: 180_000 };

/** Every pre-existing line of the session file, unchanged and in order. */
function assertRawEntriesUntouched(run) {
  const before = run.before.split('\n').filter(Boolean);
  const after = run.after.split('\n').filter(Boolean);
  assert.ok(after.length > before.length, 'the run appended entries');
  assert.deepEqual(after.slice(0, before.length), before, 'a prune must not rewrite a raw entry');
}

/** A prune is one batch: an unbroken parent chain, with nothing interleaved. */
function assertOneBatch(run) {
  const lines = fileEntries(run.after);
  const edits = lines.filter((entry) => entry.type === 'context_edit');
  assert.ok(edits.length > 0, 'the run pruned something');
  const at = lines.indexOf(edits[0]);
  assert.deepEqual(
    lines.slice(at, at + edits.length).map((entry) => entry.type),
    edits.map(() => 'context_edit'),
    'nothing is interleaved between a turn\'s edits',
  );
  assert.equal(edits[0].parentId, lines[at - 1].id, 'the batch hangs off the turn boundary that produced it');
  for (let index = 1; index < edits.length; index++) {
    assert.equal(edits[index].parentId, edits[index - 1].id, 'a second batch would break the chain');
  }
  return edits;
}

test('a pruned result is absent from the next request and its tool call is still re-runnable', TIMEOUT, () => {
  const run = runPrune({
    name: 'prune-main-',
    config: base(),
    fixture: COLD,
    ...SESSION,
    messages: 2,
  });
  assert.equal(run.report.error, undefined, run.report.error);

  const [first, second] = requests(run.records);
  assert.ok(first && second, `expected two provider requests, got ${run.records.length}`);

  // The two-sided claim, on the request the provider actually received.
  const oldest = resultEntryFor(run.before, 'MARK-r0');
  const original = oldest.message.content[0].text;
  assert.ok(first.prompt.includes(original), 'the first request carries the result in full');
  assert.equal(second.prompt.includes(original), false, 'the next request must not carry it');
  assert.equal(second.prompt.includes('END-MARK-r0'), false, 'not even the tail past the excerpt survives');
  assert.match(second.prompt, /\[pi-compaction pruned this tool result\]/);
  assert.match(second.prompt, /^Tool: read$/m);
  assert.match(second.prompt, /Re-run `read` with those arguments to recover the full result/);
  // The originating call and its full arguments are what make the re-run possible.
  assert.ok(
    second.prompt.includes('TOOLCALL read read-0-0 {"path":"/fixture/read-0-0.ts"}'),
    'the originating tool call and its full arguments must survive into the next request',
  );

  // Never an omission, and never an orphan.
  const edits = assertOneBatch(run);
  for (const edit of edits) {
    assert.notEqual(edit.replacement, null, 'null omits the entry and orphans the tool call');
    assert.ok(Array.isArray(edit.replacement.content));
    assert.equal(edit.replacement.content[0].type, 'text');
  }
  assert.deepEqual(
    run.report.toolCallIds.filter((id) => !run.report.toolResultIds.includes(id)),
    [],
    'every tool call the model sees still has a result',
  );

  // The projection shrank where it was pruned and nowhere else.
  const projected = new Map(run.report.projection.map((entry) => [entry.id, entry]));
  const raw = new Map(fileEntries(run.before).map((entry) => [entry.id, entry]));
  assert.ok(
    projected.get(oldest.id).text.length * 2 < original.length,
    'the pruned entry keeps a bounded excerpt, not the result',
  );
  const untouched = resultsFor(run.before, 'edit')[0];
  assert.equal(projected.get(untouched.id).text, raw.get(untouched.id).message.content[0].text);

  assertRawEntriesUntouched(run);
  // The report names the gate that permitted it, through both channels.
  assert.match(run.plain, /pi-compaction: pruned 16 tool results \(read\), omitting \d+ characters/);
  assert.match(run.plain, /gate: the previous request read no cached prompt tokens and wrote 50000/);
});

test('a result on the never-prune list is never pruned, and the list is the configured one', TIMEOUT, () => {
  const run = runPrune({ name: 'prune-never-', config: base(), fixture: COLD, ...SESSION, messages: 1 });
  assert.equal(run.report.error, undefined, run.report.error);
  const pruned = new Set(contextEdits(run.after).map((entry) => entry.targetId));
  const reads = resultsFor(run.before, 'read');
  const edits = resultsFor(run.before, 'edit');
  assert.ok(reads.length > 0 && edits.length > 0);
  // `edit` is on the default list, interleaved with the `read` results and the same size and age.
  assert.deepEqual(edits.filter((entry) => pruned.has(entry.id)), [], 'a never-prune result is never pruned');
  assert.equal(reads.filter((entry) => pruned.has(entry.id)).length, reads.length, 'everything else is');

  // The list is configuration, not a hard-coded set: naming `read` protects the reads instead.
  const swapped = runPrune({
    name: 'prune-never-swap-',
    config: base({ neverPrune: ['read'] }),
    fixture: COLD,
    ...SESSION,
    messages: 1,
  });
  const swappedPruned = new Set(contextEdits(swapped.after).map((entry) => entry.targetId));
  assert.deepEqual(resultsFor(swapped.before, 'read').filter((entry) => swappedPruned.has(entry.id)), []);
  assert.equal(
    resultsFor(swapped.before, 'edit').filter((entry) => swappedPruned.has(entry.id)).length,
    resultsFor(swapped.before, 'edit').length,
    'a tool the list does not name is prunable',
  );
  assertRawEntriesUntouched(swapped);
});

test('a warm cache suppresses the prune and an imminent compaction permits it anyway', TIMEOUT, () => {
  const warm = runPrune({ name: 'prune-warm-', config: base(), fixture: WARM, ...SESSION, messages: 2 });
  assert.equal(warm.report.error, undefined, warm.report.error);
  assert.deepEqual(contextEdits(warm.after), [], 'a warm prefix must not be invalidated');
  assert.doesNotMatch(warm.plain, /pi-compaction: pruned/);
  // The result is still whole in the request the provider received.
  const original = resultEntryFor(warm.before, 'MARK-r0').message.content[0].text;
  assert.ok(requests(warm.records).at(-1).prompt.includes(original));

  // Same warm cache, but the host's own threshold is already met: the prefix is about to go.
  const imminent = runPrune({
    name: 'prune-imminent-',
    config: base(),
    fixture: { ...WARM, TOTAL_TOKENS: 190_000 },
    ...SESSION,
    messages: 1,
  });
  assert.equal(imminent.report.error, undefined, imminent.report.error);
  assert.ok(contextEdits(imminent.after).length > 0, 'an imminent compaction permits the prune whatever the cache is doing');
  assert.match(imminent.plain, /gate: compaction is imminent/);
  assertRawEntriesUntouched(imminent);
});

test('the clock applies only when the request reported no cache usage', TIMEOUT, () => {
  // No cache accounting at all, and the request is older than the fallback TTL.
  const stale = runPrune({
    name: 'prune-clock-stale-',
    config: base(),
    fixture: { MESSAGE_AGE_MS: CACHE_TTL_FALLBACK_MS + 60_000 },
    ...SESSION,
    messages: 1,
  });
  assert.equal(stale.report.error, undefined, stale.report.error);
  assert.ok(contextEdits(stale.after).length > 0);
  assert.match(stale.plain, /gate: the previous request reported no cache usage and was \d+s ago, past the 300s fallback TTL/);

  // The same absent usage, inside the TTL: nothing is armed.
  const fresh = runPrune({ name: 'prune-clock-fresh-', config: base(), ...SESSION, messages: 1 });
  assert.equal(fresh.report.error, undefined, fresh.report.error);
  assert.deepEqual(contextEdits(fresh.after), [], 'the fallback clock must not fire on a fresh request');

  // A warm cache is never overridden by the clock, however old the request is.
  const warmAndStale = runPrune({
    name: 'prune-clock-warm-',
    config: base(),
    fixture: { ...WARM, MESSAGE_AGE_MS: CACHE_TTL_FALLBACK_MS + 60_000 },
    ...SESSION,
    messages: 1,
  });
  assert.deepEqual(contextEdits(warmAndStale.after), [], 'measured usage outranks the clock');
});

test('the prune window protects recent tool results and behaves at its edges', TIMEOUT, () => {
  // The upper edge: a window larger than the session's tool results protects all of them.
  const wide = runPrune({
    name: 'prune-window-wide-',
    config: base({ pruneWindowTokens: 1_000_000 }),
    fixture: COLD,
    ...SESSION,
    messages: 1,
  });
  assert.equal(wide.report.error, undefined, wide.report.error);
  assert.deepEqual(contextEdits(wide.after), [], 'a window covering every result prunes nothing');

  // In between: the newest results stay whole and the older ones go.
  const partial = runPrune({
    name: 'prune-window-mid-',
    config: base({ pruneWindowTokens: 1_200 }),
    fixture: COLD,
    ...SESSION,
    messages: 1,
  });
  assert.equal(partial.report.error, undefined, partial.report.error);
  const pruned = new Set(contextEdits(partial.after).map((entry) => entry.targetId));
  const reads = resultsFor(partial.before, 'read');
  const survivors = reads.filter((entry) => !pruned.has(entry.id));
  assert.ok(survivors.length > 0 && survivors.length < reads.length, `protected ${survivors.length} of ${reads.length}`);
  // Protection is by recency: every survivor is newer than every pruned result.
  const order = fileEntries(partial.before).map((entry) => entry.id);
  assert.ok(
    Math.min(...survivors.map((entry) => order.indexOf(entry.id)))
    > Math.max(...reads.filter((entry) => pruned.has(entry.id)).map((entry) => order.indexOf(entry.id))),
    'the window protects the newest results, not an arbitrary set',
  );
  // The lower edge: a window of zero protects nothing, which the main run already covers.
  assertRawEntriesUntouched(partial);
});

test('pruning is independent of the preset and of the summarizer strategy', TIMEOUT, () => {
  // `off` is the absence of a preset, so this run has no summarizer strategy at all and still prunes.
  const stock = runPrune({ name: 'prune-preset-off-', config: base(), fixture: COLD, ...SESSION, messages: 1 });
  assert.ok(contextEdits(stock.after).length > 0);
  assert.equal(stock.records.filter((record) => record.summarization).length, 0, 'no summary was requested');

  // Pruning off, with the deepest preset: the summarizer strategy must not turn pruning back on.
  const off = runPrune({
    name: 'prune-off-',
    config: { enabled: true, preset: 'deep', prune: false },
    fixture: COLD,
    ...SESSION,
    messages: 2,
  });
  assert.equal(off.report.error, undefined, off.report.error);
  assert.deepEqual(contextEdits(off.after), [], 'pruning off is pruning off');
  const original = resultEntryFor(off.before, 'MARK-r0').message.content[0].text;
  assert.ok(requests(off.records).at(-1).prompt.includes(original), 'the result is untouched');

  // Inert until enabled, whatever the file says about pruning.
  const inert = runPrune({ name: 'prune-inert-', fixture: COLD, ...SESSION, messages: 1 });
  assert.deepEqual(contextEdits(inert.after), [], 'an unenabled package prunes nothing');
  assertRawEntriesUntouched(inert);
});

test('activation, reload and shutdown leave no residue', TIMEOUT, () => {
  const run = runPrune({
    name: 'prune-reload-',
    config: base(),
    fixture: COLD,
    ...SESSION,
    messages: 2,
    probe: { RELOADS: 2 },
    script: [
      { expect: READY, send: '/reload\r' },
      { expect: READY, send: '/reload\r' },
      { expect: READY, send: '/prune-probe\r' },
    ],
  });
  assert.equal(run.report.error, undefined, run.report.error);
  assert.equal(run.report.reloads, 2);
  // A duplicated turn_end handler would append its own batch, or the same targets twice.
  const edits = assertOneBatch(run);
  assert.equal(edits.length, resultsFor(run.before, 'read').length);
  assert.equal(new Set(edits.map((entry) => entry.targetId)).size, edits.length, 'no target is edited twice');
  // The PTY stream repaints a notification, so counting lines proves nothing; that every reported
  // prune is the same one, together with one batch of unique targets above, does.
  const reported = [...run.plain.matchAll(/pi-compaction: pruned [^;]+; gate: [^,]+/g)].map((match) => match[0]);
  assert.ok(reported.length > 0, 'the prune was announced');
  assert.equal(new Set(reported).size, 1, `one distinct prune was reported: ${JSON.stringify(reported)}`);
  assertRawEntriesUntouched(run);
});

test('the command sets and shows every prune knob', TIMEOUT, () => {
  const run = runPrune({
    name: 'prune-command-',
    config: base({ pruneWindowTokens: 16_000 }),
    fixture: COLD,
    ...SESSION,
    messages: 1,
    script: [
      { expect: READY, send: '/compaction\r' },
      { expect: 'Prune gate:', send: '/compaction prune-window 4000\r' },
      { expect: 'Prune window: 4000 tokens of recent tool results', send: '/compaction never-prune bash,deploy\r' },
      { expect: 'Never prune: bash, deploy', send: '/compaction never-prune default\r' },
      { expect: 'Never prune: ask_user_question, bash, codemode', send: '/compaction never-prune none\r' },
      { expect: 'Never prune: (none)', send: '/compaction never-prune default\r' },
      { expect: 'Never prune: ask_user_question, bash, codemode', send: '/compaction prune-window -1\r' },
      { expect: 'usage: /compaction prune-window', send: '/compaction prune maybe\r' },
      { expect: 'usage: /compaction prune on|off', send: '/compaction prune off\r' },
      { expect: 'Prune: off', send: '/compaction preset deep\r' },
      { expect: 'Preset: deep', send: '/prune-probe\r' },
    ],
  });
  assert.equal(run.report.error, undefined, run.report.error);

  // The status view reports the prune settings and whether pruning is armed, and why.
  assert.match(run.plain, /Prune: on/);
  assert.match(run.plain, /Prune window: 16000 tokens of recent tool results/);
  assert.match(run.plain, /Never prune: ask_user_question, bash, codemode, edit, fetch_content, powershell, source_check, subagent, web_search, write/);
  assert.match(run.plain, /Prune gate: blocked — no completed request has been observed yet/);
  // An emptied list says what it costs rather than looking like the default.
  assert.match(run.plain, /Never prune: \(none\) — every tool result is prunable/);
  // Pruning off is independent of the preset: `deep` is set and nothing was pruned.
  assert.match(run.plain, /Prune: off/);
  assert.deepEqual(contextEdits(run.after), []);

  const persisted = JSON.parse(readFileSync(join(run.agent, 'extensions/pi-compaction/config.json'), 'utf8'));
  assert.equal(persisted.prune, false);
  assert.equal(persisted.pruneWindowTokens, 4_000, 'the rejected -1 changed nothing');
  assert.deepEqual(persisted.neverPrune, DEFAULT_NEVER_PRUNE);
  assert.equal(persisted.preset, 'deep');

  const names = run.report.commands.map((command) => command.name);
  assert.ok(names.includes('compaction'));
  assert.equal(run.report.commands.find((command) => command.name === 'compaction').source, 'extension');
});

test('the placeholder bounds what it keeps', TIMEOUT, () => {
  const run = runPrune({ name: 'prune-bounds-', config: base(), fixture: COLD, ...SESSION, messages: 1 });
  assert.equal(run.report.error, undefined, run.report.error);
  const edits = contextEdits(run.after);
  assert.ok(edits.length > 0);
  for (const edit of edits) {
    const text = edit.replacement.content[0].text;
    const omitted = /^Omitted: (\d+) of (\d+) characters\.$/m.exec(text);
    assert.ok(omitted, text.slice(0, 200));
    const [, dropped, total] = omitted.map(Number);
    const excerpt = /^Excerpt \(first (\d+) characters\):$/m.exec(text);
    assert.ok(excerpt);
    assert.equal(Number(excerpt[1]), Math.min(total, PLACEHOLDER_EXCERPT_CHARS));
    assert.equal(dropped, total - Number(excerpt[1]));
    assert.ok(text.length < total, 'the placeholder is smaller than what it replaces');
    const digest = /^Arguments: (.*)$/m.exec(text)[1];
    assert.ok(digest.length <= ARGUMENT_DIGEST_CHARS + 120, `digest was ${digest.length}`);
  }
  // The digest is enough to re-run: it names the path the call used.
  assert.match(edits[0].replacement.content[0].text, /"path":"\/fixture\/read-0-0\.ts"/);
});
