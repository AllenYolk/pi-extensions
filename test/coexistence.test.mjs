import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import {
  compactionEntry, compactionFixtures, deleteEntry, displayEntry, drivePi, longSession, profile, repoRoot, sessionTree, workspace,
} from './pi-collection.mjs';

/** All three extensions loaded from source, in the order a collection install uses. */
const entries = ['-e', deleteEntry, '-e', displayEntry, '-e', compactionEntry];
const isolation = ['--offline', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-extensions'];

const surviving = (dir) => readdirSync(dir).filter(name => name.endsWith('.jsonl')).length;

/** Open one session of a fresh synthetic tree and replay a key script against it. */
function driveTree(name, active, script, { args = [], env = {} } = {}) {
  const agent = profile(`${name}-`);
  const tree = sessionTree(join(agent, 'tree'));
  const result = drivePi(
    [...entries, ...args, ...isolation, '--session', tree[active], '--session-dir', tree.sessions],
    script,
    { PI_CODING_AGENT_DIR: agent, ...(typeof env === 'function' ? env(tree) : env) },
    60,
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

test('/delete removes only the current session by default', { timeout: 120000 }, () => {
  const { tree } = driveTree('current', 'main', [
    { expect: loaded, send: '/delete\r' },
    { expect: cascadeOffered, send: '\r' },
  ]);
  assert.equal(existsSync(tree.main), false, 'the current session must be gone after exit');
  assert.deepEqual(
    [tree.childA, tree.childB, tree.grandchild, tree.mainTask, tree.childATask].map(existsSync),
    [true, true, true, true, true],
    'descendants survive a current-only delete',
  );
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

test('a picker subtree cascade holds back the active session', { timeout: 120000 }, () => {
  // Cursor on the root, which is not active, but its subtree contains the open session.
  const { tree, output } = driveTree('picker-cascade', 'childA', [
    { expect: loaded, send: '/resume\r' },
    { expect: 'synthetic grandchild', send: '\u0004', settle: 1 },
    { expect: 'Delete session?', send: 't', settle: 1 },
    { expect: 'Deleted 4 sessions (1 hidden)', send: '\u001b' },
    exitPi,
  ]);
  // The key and its label are separate colour spans, so only the label is matchable.
  assert.match(output, /subtree/, 'pi-delete must add its hint to Pi\'s own confirmation line');
  assert.deepEqual(
    Object.fromEntries(['main', 'childA', 'childB', 'grandchild', 'mainTask', 'childATask'].map(k => [k, existsSync(tree[k])])),
    { main: false, childA: true, childB: false, grandchild: false, mainTask: false, childATask: true },
    'everything but the active session goes; the active session and its own subagents are held back',
  );
});

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
