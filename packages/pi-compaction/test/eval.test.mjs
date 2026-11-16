import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countSections, fabricatedPaths, pathsIn, probeMatches, scoreProbes, SECTIONS } from '../eval/score.ts';
import { DEFAULT_FIXTURE, loadFixture } from '../eval/input.ts';
import { exitCodeFor, renderTable } from '../eval/harness.ts';

const harness = fileURLToPath(new URL('../eval/harness.ts', import.meta.url));

/** Run the harness the way an operator does. No credentials are in this environment. */
function run(args) {
  const result = spawnSync(process.execPath, [harness, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PI_OFFLINE: '1' },
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
      { arm: 'cheap@low', stopReason: 'stop', outputTokens: 6281, summary },
      { arm: 'expensive@high', stopReason: 'length', outputTokens: 12812, summary },
    ],
  }));
  const result = run(['--score', record]);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /cheap@low\s+stop\s+—\s+6281/);
  assert.match(result.stdout, /expensive@high\s+length\s+—\s+12812.*\+6531/);
  // The record names a two-probe fixture; scoring against the default one would report 29.
  assert.match(result.stdout, /1\/2/);
});

test('the exit code is the arms\' own, and a clean arm list is zero', () => {
  const clean = [{ arm: 'a', summary: '', stopReason: 'stop', score: { sections: { count: 0, total: 9, missing: [] }, fabricated: [], probes: { count: 0, total: 0, lost: [] } } }];
  assert.equal(exitCodeFor(clean), 0);
  assert.equal(exitCodeFor([{ ...clean[0], stopReason: 'aborted' }]), 1);
  assert.equal(exitCodeFor([{ arm: 'a', summary: '', score: clean[0].score }]), 0, 'a summary that was never a response cannot fail');
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

test('the table renders one column per metric for an arm with nothing recorded', () => {
  const rendered = renderTable([{
    arm: 'x', summary: '',
    score: { sections: { count: 0, total: 9, missing: [] }, fabricated: [], probes: { count: 0, total: 0, lost: [] } },
  }]);
  assert.equal(rendered.split('\n').length, 3);
  assert.match(rendered.split('\n')[2], /^x\s+—\s+—\s+—\s+—\s+—\s+0\/9\s+0\s+0\/0\s+—$/);
});
