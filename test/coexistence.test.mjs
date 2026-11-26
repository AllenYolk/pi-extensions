import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import {
  compactionEntry, compactionFixtures, deleteEntry, displayEntry, driveHost, drivePi, longSession, profile, repoRoot, sessionTree, workspace,
} from './pi-collection.mjs';

/** All three extensions loaded from source, in the order a collection install uses. */
const entries = ['-e', deleteEntry, '-e', displayEntry, '-e', compactionEntry];
const isolation = ['--offline', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-extensions'];

const surviving = (dir) => readdirSync(dir).filter(name => name.endsWith('.jsonl')).length;

/** Open one session of a fresh synthetic tree and replay a key script against it. */
function driveTree(name, active, script, { args = [], env = {}, timeoutSeconds = 60, prepare, cli, allFolders = false } = {}) {
  const agent = profile(`${name}-`);
  const tree = sessionTree(join(agent, 'tree'), allFolders ? agent : undefined);
  prepare?.(tree);
  const launch = cli ? driveHost.bind(undefined, cli) : drivePi;
  const result = launch(
    [...(cli ? ['-e', deleteEntry] : entries), ...args, ...isolation, '--session', tree[active],
      ...(allFolders ? [] : ['--session-dir', tree.sessions])],
    script,
    { PI_CODING_AGENT_DIR: agent, ...(typeof env === 'function' ? env(tree) : env) },
    timeoutSeconds,
    tree.proj,
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout.slice(-3000)}`);
  return { tree, output: result.stdout };
}

// `[Extensions]` is the first startup output that proves Pi loaded both entries.
const loaded = '[Extensions]';
const cascadeOffered = 'Delete current + 5 descendants';
const exitPi = { expect: '(auto)', send: '\u0004' };

test('cancelling /delete keeps every session in the tree', { timeout: 120000 }, () => {
  const { tree } = driveTree('cancel', 'main', [
    { expect: loaded, send: '/delete\r' },
    { expect: cascadeOffered, send: '\u001b' },
    exitPi,
  ]);
  assert.equal(surviving(tree.sessions), 4, 'cancel must not delete anything');
  assert.deepEqual([tree.main, tree.mainTask, tree.childATask].map(existsSync), [true, true, true]);
});

test('/delete cascades the whole descendant subtree when chosen', { timeout: 120000 }, () => {
  const { tree } = driveTree('cascade', 'main', [
    { expect: loaded, send: '/delete\r' },
    { expect: cascadeOffered, send: '\u001b[B' },
    // Selection can repaint only menu rows, leaving the footer untouched on Linux.
    { expect: cascadeOffered, send: '\r' },
  ]);
  assert.equal(surviving(tree.sessions), 0, 'cascade removes the session and all descendants');
  assert.deepEqual(readdirSync(tree.sessions), [], 'hidden subagent sessions and their emptied directories go too');
});

test('/delete removes subagent transcripts after other extensions finish shutting down', { timeout: 120000 }, () => {
  // pi-subagents aborts running children from its own shutdown handler, which may run after ours.
  const { tree } = driveTree('late-write', 'main', [
    { expect: loaded, send: '/delete\r' },
    { expect: cascadeOffered, send: '\u001b[B' },
    { expect: cascadeOffered, send: '\r' },
  ], {
    args: ['-e', join(repoRoot, 'test/fixtures/late-writer.ts')],
    env: (tree) => ({ PI_LATE_WRITE: tree.mainTask }),
  });
  assert.deepEqual(readdirSync(tree.sessions), [], 'a transcript written during shutdown must not survive');
});

test('the picker refuses ctrl+d on the active session', { timeout: 120000 }, () => {
  // The threaded list puts the root first, so the default cursor is on the open session.
  const { tree, output } = driveTree('picker-active', 'main', [
    { expect: loaded, send: '/resume\r' },
    { expect: 'synthetic grandchild', send: '\u0004', settle: 1 },
    { expect: 'Cannot delete the currently active session', send: '\u001b' },
    exitPi,
  ]);
  assert.match(output, /Cannot delete the currently active session/);
  assert.equal(surviving(tree.sessions), 4);
});

const workspaceCli = (entry) =>
  join(dirname(findPackageJSON('@earendil-works/pi-coding-agent', pathToFileURL(entry))), 'dist/bundle/cli.js');

const hosts = [
  ['collection', undefined],
  ['pi-delete pinned Pi', workspaceCli(deleteEntry)],
  ['Pi 1.6.0', workspaceCli(displayEntry)],
];

for (const [host, cli] of hosts) {
  test(`/delete removes only the current session by default (${host})`, { timeout: 120000 }, () => {
    const { tree } = driveTree('current', 'main', [
      { expect: loaded, send: '/delete\r' },
      { expect: cascadeOffered, send: '\r' },
    ], { cli });
    assert.equal(existsSync(tree.main), false, 'the current session must be gone after exit');
    assert.deepEqual(
      [tree.childA, tree.childB, tree.grandchild, tree.mainTask, tree.childATask].map(existsSync),
      [true, true, true, true, true],
      'descendants survive a current-only delete',
    );
  });

  test(`ctrl+x does not take over native single-delete confirmation (${host})`, { timeout: 30000 }, () => {
    const { tree, output } = driveTree('native-single-delete', 'childA', [
      { expect: loaded, send: '/resume\r' },
      { expect: 'synthetic grandchild', send: '\u0004' },
      { expect: 'Delete session?', send: '\u0018\r' },
      { expect: 're:<pattern>', send: '\u001b' },
      { expect: '\u001b[?2026l', send: '\u0004' },
    ], { cli, timeoutSeconds: 12 });
    assert.match(output, /Session (moved to trash|deleted)/);
    assert.doesNotMatch(output, /Batch Delete/);
    assert.equal(existsSync(tree.main), false);
    assert.ok([tree.mainTask, tree.childA, tree.childB, tree.grandchild].every(existsSync));
  });

  test(`a picker subtree cascade holds back the active session (${host})`, { timeout: 120000 }, () => {
    // Cursor on the root, which is not active, but its subtree contains the open session.
    const { tree, output } = driveTree('picker-cascade', 'childA', [
      { expect: loaded, send: '/resume\r' },
      { expect: 'synthetic grandchild', send: '\u0004', settle: 1 },
      { expect: 'Delete session?', send: 't', settle: 1 },
      { expect: 'Deleted 4 sessions (1 hidden)', send: '\u001b' },
      { expect: '\u001b[?2026l', send: '\u0004' },
    ], { cli });
    // The key and its label are separate colour spans, so only the label is matchable.
    assert.match(output, /subtree/, 'pi-delete must add its hint to Pi\'s own confirmation line');
    assert.deepEqual(
      Object.fromEntries(['main', 'childA', 'childB', 'grandchild', 'mainTask', 'childATask'].map(k => [k, existsSync(tree[k])])),
      { main: false, childA: true, childB: false, grandchild: false, mainTask: false, childATask: true },
      'everything but the active session goes; the active session and its own subagents are held back',
    );
  });
}

// Match markers can land inside a word or escape sequence at a PTY read boundary.
const withoutMatchMarkers = (output) => output.replace(/\nPI_DRIVE_MATCHED [^\r\n]*\n/g, '');

test('Batch mode inherits /resume scope, sort, name filter, query and cursor', { timeout: 30000 }, () => {
  const { output } = driveTree('batch-entry', 'main', [
    { expect: loaded, send: '/resume\r' },
    { expect: 'synthetic child B', send: '\t' },
    { expect: 'Resume Session (All)', send: '\u0013\u000e"Batch target"\u001b[6~\u0018' },
    { expect: '›   [ ] [named] Batch target A', send: '\u001b' },
    { expect: 'Resume Session (All)', send: '\u001b' },
    exitPi,
  ], {
    timeoutSeconds: 12,
    prepare: (tree) => {
      SessionManager.open(tree.childA).appendSessionInfo('Batch target A');
      const newer = SessionManager.open(tree.grandchild);
      newer.appendSessionInfo('Batch target B');
      newer.appendMessage({ role: 'user', content: 'ensure B sorts first', timestamp: Date.now() + 1000 });
    },
  });
  const screen = withoutMatchMarkers(output);
  assert.match(screen, /scope[^\r\n]+re:<pattern>[^\r\n]+ctrl\+x[^\r\n]+select/);
  // Each filter control is its own colour span now, so only one value at a time is matchable.
  assert.match(screen, /All Folders/);
  assert.match(screen, /Recent/);
  assert.match(screen, /Named/);
  assert.match(screen, /Search: "Batch target"/);
});

for (const [host, cli] of hosts) {
  test(`Batch mode reviews and deletes marked rows and their tasks without taking unmarked forks (${host})`, { timeout: 35000 }, () => {
    const up = '\u001b[A';
    const down = '\u001b[B';
    const escape = '\u001b';
    const { tree, output } = driveTree('batch-delete', 'childB', [
      { expect: loaded, send: '/resume\r' },
      { expect: 'synthetic grandchild', send: '\u0018' },
      { expect: '0 selected', send: down + down },
      { expect: '›   [-]', send: ' ' },
      { expect: 'Cannot select the currently active session', send: up + up + ' ' },
      { expect: '1 selected', send: '\u001b[6~' + up + 't' },
      { expect: '3 selected', send: 'd' },
      { expect: 'Delete 6 sessions (3 hidden)?', send: escape },
      { expect: '3 selected', send: '\r' },
      { expect: 'Delete 6 sessions (3 hidden)?', send: '\r' },
      { expect: 'Deleted 6 sessions (3 hidden)', send: escape },
      { expect: 're:<pattern>', send: escape },
      // Wait for the editor repaint; fullscreen Pi has no (auto) footer.
      { expect: '\u001b[?2026l', send: '\u0004' },
    ], {
      cli,
      timeoutSeconds: 20,
      env: { COLORTERM: 'truecolor' },
      prepare: (tree) => {
        const newest = Date.now() + 5000;
        tree.keptFork = tree.make(tree.main, 'unmarked fork');
        SessionManager.open(tree.keptFork).appendMessage({ role: 'user', content: 'newest fork', timestamp: newest });
        SessionManager.open(tree.childB).appendMessage({ role: 'user', content: 'next newest fork', timestamp: newest - 1000 });
        SessionManager.open(tree.childA).appendSessionInfo('Deliberate batch target');
        tree.keptTask = tree.taskOf(tree.keptFork, 'unmarked fork task');
        tree.activeTask = tree.taskOf(tree.childB, 'active session task');
        tree.nestedTask = tree.taskOf(tree.childATask, 'nested hidden task');
      },
    });
    const screen = withoutMatchMarkers(output);
    assert.match(screen, /Warning: named sessions/);
    const color = /\x1b\[38;2;(\d+);(\d+);(\d+)m[^\r\n\x1b]*\[named\] Deliberate batch target/.exec(
      screen.slice(screen.indexOf('Delete 6 sessions (3 hidden)?')),
    );
    assert.ok(color && Number(color[1]) > Math.max(Number(color[2]), Number(color[3])), 'the confirmation names deliberate work in red');
    const afterConfirm = withoutMatchMarkers(output.slice(output.lastIndexOf('\nPI_DRIVE_MATCHED Delete 6 sessions (3 hidden)?\n')));
    assert.match(afterConfirm, /Batch Delete · 0 selected/, 'deletion refreshes Batch mode with the marks cleared');
    for (const key of ['main', 'childA', 'grandchild', 'mainTask', 'childATask', 'nestedTask']) {
      assert.equal(existsSync(tree[key]), false, `${key} must be deleted`);
    }
    for (const key of ['childB', 'keptFork', 'keptTask', 'activeTask']) {
      assert.equal(existsSync(tree[key]), true, `${key} must survive`);
    }
  });

  test(`Batch previews ranges, then filters and bulk-marks only visible rows (${host})`, { timeout: 35000 }, () => {
    const escape = '\u001b';
    const first = 'coexistence root session';
    const lastPreview = '› │ [ ]    └─ synthetic grandchild';
    const { tree, output } = driveTree('batch-range', 'childB', [
      { expect: loaded, send: '/resume\r' },
      { expect: 'synthetic grandchild', send: '\u0018' },
      { expect: '0 selected', send: 'gv' },
      { expect: 'Range anchor', send: 'G' },
      { expect: lastPreview, send: 'g' },
      { expect: `› │ [ ] ${first}`, send: escape },
      { expect: `›   [ ] ${first}`, send: 'vG' },
      { expect: lastPreview, send: ' ' },
      { expect: '3 selected', send: '/"synthetic"\r' },
      { expect: '3 selected (1 hidden)', send: 'a' },
      { expect: '1 selected (1 hidden)', send: 'i' },
      { expect: '3 selected (1 hidden)', send: 'c' },
      { expect: '0 selected', send: 'a' },
      { expect: '2 selected', send: 'd' },
      { expect: 'Delete 3 sessions (1 hidden)?', send: '\r' },
      { expect: 'Deleted 3 sessions (1 hidden)', send: escape },
      { expect: 're:<pattern>', send: escape },
      { expect: '\u001b[?2026l', send: '\u0004' },
    ], {
      cli,
      timeoutSeconds: 20,
      prepare: (tree) => {
        SessionManager.open(tree.childB).appendMessage({ role: 'user', content: 'newest child', timestamp: Date.now() + 5000 });
        tree.activeTask = tree.taskOf(tree.childB, 'active session task');
      },
    });
    const screen = withoutMatchMarkers(output);
    assert.match(screen, /│ \[-\].*synthetic child B/);
    const beforeCommit = withoutMatchMarkers(output.slice(0, output.lastIndexOf(`\nPI_DRIVE_MATCHED ${lastPreview}\n`)));
    assert.doesNotMatch(beforeCommit, /\[x\]/, 'preview and cancellation must not mark anything');
    for (const key of ['childA', 'grandchild', 'childATask']) assert.equal(existsSync(tree[key]), false, key);
    for (const key of ['main', 'mainTask', 'childB', 'activeTask']) assert.equal(existsSync(tree[key]), true, key);
  });

  test(`Batch filters, marks and deletes across folders, then restores native search (${host})`, { timeout: 40000 }, () => {
    const escape = '\u001b';
    const { tree, output } = driveTree('batch-filters', 'main', [
      { expect: loaded, send: '/resume\r' },
      { expect: 'synthetic grandchild', send: '\u0013\u000esynthetic\u0018' },
      // Each filter control is its own colour span now, so a step waits on one batch-only value.
      { expect: 'Any age', send: 'nnomsp' },
      { expect: '≤2 msgs', send: '/\u0015"CACHE   TRIM"\r' },
      { expect: '›   [ ] Old cache trim', send: ' ' },
      { expect: '1 selected', send: '/\u0015cch trm' + escape },
      { expect: 'Search: cch trm', send: '/\u0015re:stash[0-9]\r' },
      { expect: 'Search: re:stash[0-9]', send: 'n\t' },
      { expect: '›   [ ] [named] Deliberate remote', send: ' ' },
      { expect: '2 selected (1 hidden)', send: '\t' },
      { expect: '2 selected (2 hidden)', send: 'd' },
      { expect: 'Delete 4 sessions (2 hidden)?', send: '\r' },
      { expect: 'Deleted 4 sessions (2 hidden)', send: '\t' },
      { expect: 'All Folders', send: escape },
      { expect: 'Away kept', send: escape },
      { expect: '\u001b[?2026l', send: '\u0004' },
    ], {
      cli,
      allFolders: true,
      timeoutSeconds: 25,
      prepare: (tree) => {
        const timestamp = Date.now() - 45 * 86_400_000;
        tree.oldShort = tree.make(undefined, 'Old cache trim', undefined, { timestamp });
        tree.newShort = tree.make(undefined, 'New cache trim');
        tree.oldLong = tree.make(undefined, 'Old cache trim log', undefined, { timestamp });
        SessionManager.open(tree.oldLong).appendMessage({ role: 'user', content: 'third message', timestamp });
        SessionManager.open(tree.childA).appendSessionInfo('Here kept');
        const cwd = join(dirname(tree.proj), 'second-folder');
        mkdirSync(cwd);
        tree.remote = tree.make(undefined, 'stash42', undefined, { cwd, timestamp });
        SessionManager.open(tree.remote).appendSessionInfo('Deliberate remote');
        tree.remoteTask = tree.taskOf(tree.remote, 'hidden remote work');
        tree.remoteNested = tree.taskOf(tree.remoteTask, 'nested remote work');
        tree.remoteFork = tree.make(tree.remote, 'Unmarked remote fork', undefined, { cwd, timestamp });
        const retained = tree.make(undefined, 'synthetic remote retained', undefined, { cwd });
        SessionManager.open(retained).appendSessionInfo('Away kept');
        const ignored = tree.make(undefined, 'unrelated remote retained', undefined, { cwd });
        SessionManager.open(ignored).appendSessionInfo('Skip name');
      },
    });
    const screen = withoutMatchMarkers(output);
    const phraseScreen = withoutMatchMarkers(output.slice(
      output.indexOf('\nPI_DRIVE_MATCHED ≤2 msgs\n'),
      output.indexOf('\nPI_DRIVE_MATCHED › [ ] Old cache trim\n'),
    ));
    assert.match(phraseScreen, /Search: "CACHE   TRIM"/);
    assert.doesNotMatch(phraseScreen, /New cache trim|Old cache trim log/);
    assert.match(screen, /\[x\] Old cache trim[^\r\n]+/);
    assert.ok(screen.includes(basename(tree.oldShort).slice(-16)), 'p shows the session path');
    assert.match(screen, /2 listed · 2 hidden/);
    assert.match(screen, /Warning: named sessions/);
    const restored = screen.slice(screen.lastIndexOf('Resume Session (All)'));
    assert.match(restored, /Resume Session \(All\)/);
    assert.match(restored, /Recent/);
    assert.match(restored, /> synthetic/);
    assert.match(restored, /Away kept/);
    assert.doesNotMatch(restored, /Skip name|Unmarked|Deliberate|Old cache|Paths on|>7d|≤2 msgs/);
    for (const key of ['oldShort', 'remote', 'remoteTask', 'remoteNested']) assert.equal(existsSync(tree[key]), false, key);
    for (const key of ['main', 'newShort', 'oldLong', 'remoteFork']) assert.equal(existsSync(tree[key]), true, key);
  });
}

test('all three extensions install, group, expand and restore across repeated reloads', { timeout: 240000 }, () => {
  const agent = profile('coexistence-');
  const resultFile = join(agent, 'result.json');
  const reloads = 4;
  const script = [{ expect: loaded, send: '/coexistence-probe\r' }];
  for (let round = 0; round < reloads; round++) {
    script.push({ expect: 'PI_COEXISTENCE_READY', send: '/coexistence-probe\r' });
  }
  const result = drivePi(
    [...entries, '-e', join(repoRoot, 'test/fixtures/coexistence-probe.ts'), ...isolation, '--no-session'],
    script,
    { PI_CODING_AGENT_DIR: agent, PI_COEXISTENCE_RESULT: resultFile, PI_COEXISTENCE_RELOADS: String(reloads) },
    180,
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout.slice(-3000)}`);
  const report = JSON.parse(readFileSync(resultFile, 'utf8'));
  assert.equal(report.passed, true, report.error);
  assert.equal(report.shutdownRestored, true, 'both patches must be restored on final shutdown');
  assert.equal(report.reloads, reloads);
  assert.equal(report.groupedCalls, 3);
  assert.match(report.collapsed, /bash ×3/);
});

test('compaction stays stock while the package is present and not enabled', { timeout: 180000 }, () => {
  // The agent directory carries no pi-compaction configuration, so the package is inert.
  const agent = profile('coexistence-inert-');
  assert.equal(existsSync(join(agent, 'extensions/pi-compaction/config.json')), false);

  const box = workspace('coexistence-inert-');
  const proj = join(box, 'proj');
  const sessions = join(box, 'sessions');
  const session = longSession(SessionManager, { cwd: proj, sessionDir: sessions, turns: 40 });
  const recordFile = join(box, 'requests.jsonl');
  const resultFile = join(box, 'report.json');

  const result = drivePi(
    [...entries,
      '-e', join(compactionFixtures, 'fake-provider.ts'),
      '-e', join(compactionFixtures, 'compaction-probe.ts'),
      ...isolation, '--session', session.file, '--session-dir', sessions, '/compaction-probe'],
    [],
    {
      PI_CODING_AGENT_DIR: agent,
      PI_COMPACTION_FIXTURE_RECORD: recordFile,
      PI_COMPACTION_PROBE_RESULT: resultFile,
      PI_COMPACTION_PROBE_MODEL: 'minimax-cn/pi-compaction-conversation',
    },
    150,
    proj,
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.doesNotMatch(result.stdout, /PI_DRIVE_TIMEOUT/, result.stderr);
  const report = JSON.parse(readFileSync(resultFile, 'utf8'));
  assert.equal(report.error, undefined, report.error);
  assert.deepEqual(report.compactions.map((compaction) => compaction.ok), [true], JSON.stringify(report.compactions));

  const persisted = readFileSync(session.file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'compaction');
  assert.equal(persisted.length, 1, 'one compaction');
  assert.equal(persisted[0].fromHook ?? false, false, 'the compaction must not be hook-originated');

  const summarizers = readFileSync(recordFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    .filter((record) => record.summarization);
  assert.equal(summarizers.length, 1, 'stock Pi issues exactly one summarization request');
  assert.equal(summarizers[0].model, 'minimax-cn/pi-compaction-conversation', 'stock Pi summarises with the conversation model');
  // Stock Pi summarises with the conversation model, which is also this package's default, so the
  // model no longer discriminates. What does: an enabled package sets per-level thinking budgets,
  // which no host adapter ever sets, and its compaction is recorded as hook-originated. The host's
  // own output option is left alone here — this repository's root host still caps a summary at
  // 0.8 x the reserved tokens, a cap Pi 1.5.1 no longer applies.
  assert.equal(summarizers[0].options.thinkingBudgets, undefined);
  // Stock Pi also reuses the session's own thinking level for the summary request, which is the
  // other half of what the package exists to change.
});
