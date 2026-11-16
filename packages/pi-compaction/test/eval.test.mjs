import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countSections, fabricatedPaths, pathsIn, probeMatches, scoreProbes, SECTIONS } from '../eval/score.ts';
import { DEFAULT_FIXTURE, loadFixture } from '../eval/input.ts';
import {
  armInstructions,
  exitCodeFor,
  parseArgs,
  parseArm,
  renderTable,
  scoreArms,
  usageOf,
} from '../eval/harness.ts';
import { THINKING_LEVELS } from '../src/config.ts';

const harness = fileURLToPath(new URL('../eval/harness.ts', import.meta.url));

/**
 * Run the harness the way an operator does, against a disposable profile.
 *
 * The empty agent directory is what makes that safe: `--score` needs nothing from it, and an `--arm`
 * invocation — including one this suite expects to be refused — finds no model and no configured
 * credentials there, so no test can reach a provider or spend money whatever the harness does with
 * the arguments it was handed.
 */
function run(args) {
  const agent = mkdtempSync(join(tmpdir(), 'pi-compaction-agent-'));
  const result = spawnSync(process.execPath, [harness, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PI_OFFLINE: '1', PI_CODING_AGENT_DIR: agent },
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

/** A summary with all nine of the host's headings, written out rather than generated. */
const complete = `## Goal
Ship the lock fix.

## Constraints & Preferences
- do not change the on-disk format

## Progress
### Done
- [x] Bisected the regression.

### In Progress
- [ ] Land the fix.

### Blocked
- (none)

## Key Decisions
- **One commit**: the revert has to be a pure code revert.

## Next Steps
1. Deploy to one staging node.

## Critical Context
- The freeze is 2026-03-14.
`;

test('a summary with every heading scores 9/9', () => {
  assert.equal(countSections(complete).count, 9);
  assert.equal(SECTIONS.length, 9);
});

test('a summary missing ## Next Steps scores 8/9', () => {
  const missing = complete.replace('## Next Steps\n1. Deploy to one staging node.\n\n', '');
  const scored = countSections(missing);
  assert.equal(scored.count, 8);
  assert.deepEqual(scored.missing, ['## Next Steps']);
});

const range = 'read src/index/manifest.ts, then src/cache/spill.rs, and wrote src/index/reopen.ts';

test('a summary naming a path absent from the range scores one fabrication', () => {
  const summary = 'Touched src/index/manifest.ts and src/cache/ledger.rs, which does not exist.';
  assert.deepEqual(fabricatedPaths(summary, range), ['src/cache/ledger.rs']);
});

test('a path the range names under a longer prefix is not a fabrication', () => {
  const range = 'read /home/u/proj/src/index/manifest.ts and packages/app/src/x.ts';
  assert.deepEqual(fabricatedPaths('Touched src/index/manifest.ts and src/x.ts.', range), []);
  // The prefix still has to end at a separator: a longer *segment* is a different path.
  assert.deepEqual(fabricatedPaths('Touched src/index.ts.', 'wrote mysrc/index.ts'), ['src/index.ts']);
});

test('a path that is only a prefix of a different path in the range is a fabrication', () => {
  const sibling = 'wrote src/cache/spill.rs2 and src/index/manifest.ts';
  assert.deepEqual(fabricatedPaths('Touched src/cache/spill.rs.', sibling), ['src/cache/spill.rs']);
});

test('every path the range contains is not a fabrication, however often it is named', () => {
  const summary = 'src/index/reopen.ts, src/index/reopen.ts and src/cache/spill.rs again';
  assert.deepEqual(fabricatedPaths(summary, range), []);
});

test('a URL, a model name and a bare filename are not file paths', () => {
  const named = pathsIn([
    'See https://example.com/docs/adr/0005.html for the reasoning.',
    'Summarised with minimax-cn/MiniMax-M3.1-Flash at low, on release/0.9, v0.9.3.',
    'The sidecar is manifest.sidecar and the port is 7717.',
  ].join('\n'));
  assert.deepEqual(named, []);
});

test('a path is recognised whatever punctuation surrounds it', () => {
  assert.deepEqual(pathsIn('`src/index/reopen.ts`, (src/cache/spill.rs).'), ['src/index/reopen.ts', 'src/cache/spill.rs']);
});

const probes = [
  { id: 'commit', kind: 'literal', value: '9f3c1ab7' },
  { id: 'latency', kind: 'regex', value: '412\\s*ms' },
];

test('a probe present and a probe absent score kept and lost', () => {
  const scored = scoreProbes('The regression came from 9f3c1ab7, bisected yesterday.', probes);
  assert.equal(scored.count, 1);
  assert.equal(scored.total, 2);
  assert.deepEqual(scored.lost, ['latency']);
});

test('a regex probe tolerates the spacing a summarizer rewrites', () => {
  assert.equal(probeMatches(probes[1], 'p95 was 412 ms before the change'), true);
  assert.equal(probeMatches(probes[1], 'p95 was 412ms before the change'), true);
  assert.equal(probeMatches(probes[1], 'p95 was 380 ms before the change'), false);
});

test('a literal probe is matched exactly, not case-insensitively', () => {
  assert.equal(probeMatches(probes[0], 'commit 9f3c1ab7'), true);
  assert.equal(probeMatches(probes[0], 'commit 9F3C1AB7'), false);
});

const committed = loadFixture(DEFAULT_FIXTURE);

test('the committed fixture declares at least 20 probes, and every one occurs in its own session', () => {
  assert.ok(committed.probes.length >= 20, `${committed.probes.length} probes`);
  assert.deepEqual(committed.dropped, []);
  // The strict reading: a probe has to be in the summarised messages themselves, not merely in the
  // previous summary the update prompt carries forward.
  for (const probe of committed.probes) {
    assert.ok(probeMatches(probe, committed.sessionText), `probe ${probe.id} is not in the session`);
  }
});

test('the fixture yields one summarised range and a kept window, with no split turn', () => {
  assert.ok(committed.sessionText.length > 0);
  assert.equal(committed.prepared.isSplitTurn, false);
  assert.ok(committed.prepared.messagesToSummarize.length > 0);
  assert.ok(committed.range.startsWith(committed.sessionText));
  assert.ok(committed.range.includes(committed.previousSummary.trim()));
});

/** A manifest over the committed session, so only the probes differ. */
function manifestWith(probes) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-compaction-eval-'));
  const path = join(dir, 'fixture.json');
  writeFileSync(path, JSON.stringify({
    session: committed.sessionPath,
    previousSummary: committed.previousSummaryPath,
    keptWindowTokens: committed.keptWindowTokens,
    probes,
  }));
  return path;
}

test('a probe the session does not contain is rejected rather than scored', () => {
  const path = manifestWith([
    { id: 'real', kind: 'literal', value: '9f3c1ab7' },
    { id: 'ghost', kind: 'literal', value: 'a-string-the-session-never-contains' },
  ]);
  assert.throws(() => loadFixture(path), /ghost/);
});

test('a manifest is held to its own probes even when a record names its session back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-compaction-eval-'));
  const fixture = manifestWith([{ id: 'ghost', kind: 'literal', value: 'a-string-the-session-never-contains' }]);
  const record = join(dir, 'run.json');
  writeFileSync(record, JSON.stringify({
    fixture,
    session: committed.sessionPath,
    arms: [{ arm: 'a', stopReasons: ['stop'], summary }],
  }));
  const result = run(['--score', record]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stderr, /ghost/);
});

test('a probe with an unusable regex is rejected', () => {
  const path = manifestWith([{ id: 'broken', kind: 'regex', value: '412\\s*(' }]);
  assert.throws(() => loadFixture(path), /broken/);
});

/**
 * A summary written by hand, scored against a two-probe manifest over the committed session:
 * every section, one path that is not in the range, one probe kept and one lost.
 */
const summary = `## Goal
Land the lock fix before the freeze.

## Constraints & Preferences
- do not change the on-disk format

## Progress
### Done
- [x] Bisected to 9f3c1ab7.

### In Progress
- [ ] Land src/index/reopen.ts and src/cache/invented.rs.

### Blocked
- (none)

## Key Decisions
- **One commit**: the revert has to be a pure code revert.

## Next Steps
1. Deploy to one staging node.

## Critical Context
- The freeze is 2026-03-14.
`;

const twoProbes = manifestWith([
  { id: 'commit', kind: 'literal', value: '9f3c1ab7' },
  { id: 'never-written', kind: 'literal', value: '4c02be91' },
]);

function scoredSummaryFile() {
  const dir = mkdtempSync(join(tmpdir(), 'pi-compaction-eval-'));
  const path = join(dir, 'arm-a.md');
  writeFileSync(path, summary);
  return path;
}

test('--score prints one row of arms and metrics, and exits zero', () => {
  const result = run(['--score', scoredSummaryFile(), '--fixture', twoProbes]);
  assert.equal(result.status, 0, result.stderr);
  const [header, , row] = result.stdout.trimEnd().split('\n');
  assert.match(header, /^arm\s+stop\s+wall\s+out tok\s+reason tok\s+cost\s+sections\s+fabricated\s+probes\s+Δ out$/);
  assert.match(row, /^arm-a\s+—\s+—\s+—\s+—\s+—\s+9\/9\s+1\s+1\/2\s+—$/);
});

test('the table is stable across runs', () => {
  const file = scoredSummaryFile();
  const first = run(['--score', file, '--fixture', twoProbes]);
  const second = run(['--score', file, '--fixture', twoProbes]);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.status, second.status);
});

test('--json emits the same data as the table', () => {
  const result = run(['--score', scoredSummaryFile(), '--fixture', twoProbes, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.arms.length, 1);
  assert.deepEqual(record.arms[0].score.sections, { count: 9, total: 9, missing: [] });
  assert.deepEqual(record.arms[0].score.fabricated, ['src/cache/invented.rs']);
  assert.deepEqual(record.arms[0].score.probes, { count: 1, total: 2, lost: ['never-written'] });
  assert.equal(record.arms[0].stopReason, undefined);
});

test('two scored summaries are compared against the first as the control', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-compaction-eval-'));
  const shorter = join(dir, 'arm-b.md');
  writeFileSync(shorter, summary.replace(/## Critical Context[\s\S]*$/, ''));
  const result = run(['--score', scoredSummaryFile(), '--score', shorter, '--fixture', twoProbes]);
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout.trimEnd().split('\n').slice(2);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /arm-a .* 9\/9\s+1\s+1\/2/);
  assert.match(rows[1], /arm-b .* 8\/9\s+1\s+1\/2/);
});

test('a recorded arm that did not stop with "stop" exits non-zero, and is scored against its own fixture', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-compaction-eval-'));
  const record = join(dir, 'run.json');
  writeFileSync(record, JSON.stringify({
    fixture: twoProbes,
    arms: [
      { arm: 'cheap@low', stopReasons: ['stop'], outputTokens: 6281, summary },
      { arm: 'expensive@high', stopReasons: ['length'], outputTokens: 12812, summary },
    ],
  }));
  const result = run(['--score', record]);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /cheap@low\s+stop\s+—\s+6281/);
  assert.match(result.stdout, /expensive@high\s+length\s+—\s+12812.*\+6531/);
  // The record names a two-probe fixture; scoring against the default one would report 29.
  assert.match(result.stdout, /1\/2/);
});

/**
 * A split turn makes two summarization requests through the same stream function and the host
 * concatenates both, so the history group's response and the turn-prefix group's response are two
 * groups of one attempt. A clean second group says nothing about a partial first one.
 */
const splitTurn = {
  fixture: twoProbes,
  arms: [{ arm: 'split@low', stopReasons: ['aborted', 'stop'], outputTokens: 900, summary }],
};

test('a split turn whose first response group is partial fails, whatever the second did', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-compaction-eval-'));
  const record = join(dir, 'run.json');
  writeFileSync(record, JSON.stringify(splitTurn));
  const result = run(['--score', record]);
  assert.equal(result.status, 1, `a partial group must fail the run:\n${result.stdout}`);
  assert.match(result.stdout, /split@low\s+aborted,stop/);
});

test('a split turn whose every group stopped cleanly passes, and both groups are shown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-compaction-eval-'));
  const record = join(dir, 'run.json');
  writeFileSync(record, JSON.stringify({
    ...splitTurn,
    arms: [{ ...splitTurn.arms[0], stopReasons: ['stop', 'stop'] }],
  }));
  const result = run(['--score', record]);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /split@low\s+stop\s/);
});

test('an attempt that observed no response at all is not a clean one', () => {
  assert.equal(exitCodeFor([arm({ stopReasons: [] })]), 1);
  assert.equal(exitCodeFor([arm({ stopReasons: ['stop'] })]), 0);
  assert.equal(exitCodeFor([arm({ stopReasons: ['stop', 'stop'] })]), 0);
  assert.equal(exitCodeFor([arm({ stopReasons: ['stop', 'aborted'] })]), 1);
  assert.equal(exitCodeFor([arm({ stopReasons: [null] })]), 1, 'a response with no stop reason is not a proven-complete one');
  assert.equal(exitCodeFor([arm({})]), 0, 'a summary that was never a response cannot fail');
});

/** A recorded run over a session that is not the fixture's own must be scored over that session. */
function recordedSessionRun() {
  const dir = mkdtempSync(join(tmpdir(), 'pi-compaction-eval-'));
  // The committed session with one real path renamed — a path the previous summary does not mention,
  // so the probe for it is genuinely absent from the whole range. A summary naming the renamed path
  // is honest against this session and a fabrication against the fixture's own.
  const session = join(dir, 'renamed.jsonl');
  writeFileSync(session, readFileSync(committed.sessionPath, 'utf8')
    .replaceAll('src/index/reopen.ts', 'src/index/reopen2.ts'));
  // The manifest still declares the committed session: this is a `--session` run, not a new fixture.
  const fixture = manifestWith([
    { id: 'commit', kind: 'literal', value: '9f3c1ab7' },
    { id: 'file-reopen', kind: 'literal', value: 'src/index/reopen.ts' },
  ]);
  const record = join(dir, 'run.json');
  writeFileSync(record, JSON.stringify({
    fixture,
    session,
    arms: [{ arm: 'real@low', stopReasons: ['stop'], outputTokens: 800, summary: renamedSummary }],
  }));
  return { record, session, fixture };
}

const renamedSummary = `## Goal
Land the lock fix.

## Constraints & Preferences
- do not change the on-disk format

## Progress
### Done
- [x] Bisected to 9f3c1ab7.

### In Progress
- [ ] Land src/index/reopen2.ts.

### Blocked
- (none)

## Key Decisions
- **One commit**: the revert has to be a pure code revert.

## Next Steps
1. Deploy to one staging node.

## Critical Context
- The freeze is 2026-03-14.
`;

test('a recorded --session run is scored over the session it summarised', () => {
  const { record } = recordedSessionRun();
  const result = run(['--score', record]);
  assert.equal(result.status, 0, result.stdout);
  // src/index/reopen2.ts is in the recorded session, so it is not a fabrication; the fixture's own
  // session does not contain it, and scoring there would report one.
  assert.match(result.stdout, /real@low\s+stop\s+—\s+800\s+—\s+—\s+9\/9\s+0\s+1\/1/);
  // The probe for the old path is absent from that session, so it is reported and left out of the
  // score rather than counted as a probe the summarizer lost.
  assert.match(result.stderr, /not scored, absent from the session: file-reopen/);
});

test('an arm may carry redistill thresholds, and a malformed pair is refused', () => {
  assert.deepEqual(parseArm('minimax-cn/MiniMax-M3.1-Flash@low'), {
    name: 'minimax-cn/MiniMax-M3.1-Flash',
    thinking: 'low',
    redistill: null,
  });
  assert.deepEqual(parseArm('mafia-o/gpt-6.1-sol@high+4000:6000').redistill, {
    aboveTokens: 4_000,
    targetTokens: 6_000,
  });
  // The bounds are the configuration's own, so an arm cannot measure an instruction the package would
  // refuse to send — or one naming a number the operator never typed.
  assert.deepEqual(parseArm('a/b@low+1:1000000').redistill, { aboveTokens: 1, targetTokens: 1_000_000 });
  for (const spec of [
    'a/b@low+4000',
    'a/b@low+4000:',
    'a/b@low+x:6000',
    'a/b@low+0:6000',
    'a/b@low+4000:6000:1',
    'a/b@low+4000:0',
    'a/b@low+1000001:6000',
    // 1e39 and 1e35: finite, integral, and far outside the bound.
    'a/b@low+1:999999999999999999999999999999999999999',
    'a/b@low+4000:99999999999999999999999999999999999',
    // Long enough to overflow to Infinity, which no comparison against a bound catches on its own.
    `a/b@low+1:${'9'.repeat(400)}`,
  ]) {
    assert.throws(() => parseArm(spec), /must be <provider\/model>@<thinking>/, spec);
  }
  const malformed = run(['--arm', 'a/b@low+4000', '--arm', 'c/d@low']);
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /must be <provider\/model>@<thinking>/);
  const unbounded = run(['--arm', `a/b@low+1:${'9'.repeat(400)}`, '--arm', 'c/d@low']);
  assert.equal(unbounded.status, 2, unbounded.stderr);
  assert.match(unbounded.stderr, /must be <provider\/model>@<thinking>/);
});

test('an arm\'s thresholds decide the instruction the harness would ask for', () => {
  // What this covers, precisely: `armInstructions` — the value `runLive` puts in `compact()`'s fifth
  // argument and in the run record. It does not drive `runLive` itself, which needs credentials and is
  // never run by a check, so a change that stopped passing this value to `compact()` would not be
  // caught here. `runLive` computes it once and uses it for both the request and the record.
  const fixture = loadFixture(DEFAULT_FIXTURE);
  // The committed fixture's previous summary is 261 tokens, so #31's own 4,000-token threshold asks
  // for nothing here: an arm at that threshold is the control arm with a misleading name.
  assert.equal(armInstructions(fixture, 'a/b@low+4000:6000'), undefined);
  const asked = armInstructions(fixture, 'a/b@low+200:6000');
  assert.match(asked, /^The previous summary is 261 tokens and the merged summary should stay under 6000\./);
  assert.equal(armInstructions(fixture, 'a/b@low'), undefined, 'an arm without thresholds is the control');

  // The hook's gate applies here too: an arm must not measure an instruction this host would refuse to
  // send, and `eval/README.md` says the recorded text is what the package would ask for.
  const broken = { ok: false, detail: 'estimateTokens() returned NaN' };
  assert.equal(armInstructions(fixture, 'a/b@low+200:6000', broken), undefined, 'a failed token-seam probe asks for nothing');
  assert.equal(armInstructions(fixture, 'a/b@low', broken), undefined);
});

test('the exit code is the arms\' own, and a clean arm list is zero', () => {
  assert.equal(exitCodeFor([arm({ stopReasons: ['stop'] })]), 0);
  assert.equal(exitCodeFor([arm({ stopReasons: ['aborted'] })]), 1);
  assert.equal(exitCodeFor([arm({})]), 0, 'a summary that was never a response cannot fail');
});

test('--help prints usage on stdout and exits zero, while bad usage still exits two', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0, `asking for help is not bad usage:\n${help.stderr}`);
  assert.match(help.stdout, /^usage:/);
  assert.match(help.stdout, /Exit status: 0 all arms stopped cleanly/);
  assert.equal(help.stderr, '', 'usage goes to stdout, not stderr');
  const bogus = run(['--nope']);
  assert.equal(bogus.status, 2, 'a genuinely invalid argument is still bad usage');
  assert.match(bogus.stderr, /unknown argument --nope/);
});

test('every thinking level the package accepts is a valid arm level', () => {
  // The harness refuses a level outside the package's set, so a second hand-written copy of that set
  // would drift the other way: a level added to the package would become an exit-2 usage error here.
  assert.ok(THINKING_LEVELS.length > 0);
  for (const level of THINKING_LEVELS) {
    assert.doesNotThrow(
      () => parseArgs(['--arm', `provider/model@${level}`, '--arm', `provider/other@${level}`]),
      `the package accepts ${level}, so an arm naming it must not be bad usage`,
    );
  }
});

test('an arm naming a thinking level that does not exist is refused rather than clamped', () => {
  const bogus = run(['--arm', 'no-such-provider/no-such-model@banana', '--arm', 'no-such-provider/other@low']);
  assert.equal(bogus.status, 2, `an unknown level must be bad usage:\n${bogus.stdout}`);
  assert.equal(bogus.stdout, '', 'nothing may be measured');
  assert.match(bogus.stderr, /banana/);
  assert.match(bogus.stderr, /off, minimal, low, medium, high, xhigh, max/);
});

test('an unrecognised argument and a single arm are refused before anything runs', () => {
  const bogus = run(['--nope']);
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /unknown argument --nope/);
  const single = run(['--arm', 'minimax-cn/MiniMax-M3.1-Flash@low']);
  assert.equal(single.status, 2);
  assert.match(single.stderr, /at least two arms/);
  const both = run(['--arm', 'a/b@low', '--arm', 'c/d@low', '--score', 'x.md']);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /different modes/);
  const malformed = run(['--arm', 'no-thinking-level', '--arm', 'c/d@low']);
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /must be <provider\/model>@<thinking>/);
  const scored = run(['--score', scoredSummaryFile(), '--out', '/tmp/nowhere']);
  assert.equal(scored.status, 2);
  assert.match(scored.stderr, /scoring writes nothing/);
});

/** The minimum `scoreArms` needs from a fixture: what to score a summary's probes and paths against. */
const stubFixture = { probes: [], range: 'read src/index/manifest.ts, then src/cache/spill.rs' };

test('a first arm that was never measured does not cost the table its Δ out', () => {
  const scored = scoreArms(stubFixture, [
    { arm: 'p/broken@low', summary: '## Goal\nx', stopReasons: ['unauthenticated'], error: 'no configured credentials' },
    { arm: 'p/good@low', summary: '## Goal\nx', stopReasons: ['stop'], outputTokens: 1500 },
    { arm: 'p/good2@low', summary: '## Goal\nx', stopReasons: ['stop'], outputTokens: 1200 },
  ]);
  assert.equal(scored[0].outputDelta, undefined, 'an arm that was never measured has no Δ of its own');
  assert.equal(scored[1].outputDelta, 0, 'the first arm that reported output tokens is the baseline');
  assert.equal(scored[2].outputDelta, -300);
});

test('a run whose first arm was never measured says which arm Δ out fell back to', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-compaction-eval-'));
  const record = join(dir, 'run.json');
  writeFileSync(record, JSON.stringify({
    fixture: twoProbes,
    arms: [
      { arm: 'p/broken@low', stopReasons: ['unauthenticated'], error: 'no configured credentials', summary },
      { arm: 'p/good@low', stopReasons: ['stop'], outputTokens: 1500, summary },
      { arm: 'p/good2@low', stopReasons: ['stop'], outputTokens: 1200, summary },
    ],
  }));
  const result = run(['--score', record]);
  assert.match(result.stderr, /Δ out is measured against p\/good@low/, result.stderr);
  assert.match(result.stderr, /p\/broken@low/, result.stderr);
  assert.match(result.stdout, /p\/good2@low\s+stop\s+—\s+1200\s+—\s+—\s+9\/9\s+1\s+1\/2\s+-300/, result.stdout);
});

test('an arm the host reported no usage for is unmeasured, not measured as zero', () => {
  // A host response carries usage per attempt. An attempt whose response carried none was not
  // measured, and a recorded zero would be indistinguishable from a cheap arm.
  assert.deepEqual(usageOf(undefined), {});
  assert.deepEqual(usageOf({}), {});
  assert.deepEqual(usageOf({ output: 0, cost: { total: 0 } }), { outputTokens: 0, cost: 0 },
    'a zero the host reported is a measurement');

  const text = 'Touched src/index/manifest.ts.';
  const scored = scoreArms(stubFixture, [
    { arm: 'a@low', summary: text, stopReasons: ['stop'], ...usageOf({ output: 6281, cost: { total: 0.0123 } }) },
    { arm: 'b@low', summary: text, stopReasons: ['stop'], ...usageOf(undefined) },
  ]);
  assert.equal(scored[1].outputTokens, undefined, 'no output tokens is not zero output tokens');
  assert.equal(scored[1].cost, undefined, 'no cost is not a cost of nothing');
  assert.equal(scored[1].outputDelta, undefined, 'a Δ against an arm that was never measured is not a number');
  assert.equal(scored[0].outputDelta, 0, 'the control arm is measured against itself, and that is a real zero');
  assert.match(renderTable(scored).split('\n')[3], /^b@low\s+stop\s+—\s+—\s+—\s+—\s+0\/9\s+0\s+0\/0\s+—$/);
});

test('the table renders one column per metric for an arm with nothing recorded', () => {
  const rendered = renderTable([arm({})]);
  assert.equal(rendered.split('\n').length, 3);
  assert.match(rendered.split('\n')[2], /^x\s+—\s+—\s+—\s+—\s+—\s+0\/9\s+0\s+0\/0\s+—$/);
});

/** A scored arm with the given recorded fields and an empty score. */
function arm(record) {
  return {
    arm: 'x', summary: '', ...record,
    score: { sections: { count: 0, total: 9, missing: [] }, fabricated: [], probes: { count: 0, total: 0, lost: [] } },
  };
}
