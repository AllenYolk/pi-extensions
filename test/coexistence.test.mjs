import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deleteEntry, displayEntry, drivePi, profile, repoRoot, sessionTree } from './pi-collection.mjs';

/** Both extensions loaded from source, in the order a collection install uses. */
const entries = ['-e', deleteEntry, '-e', displayEntry];
const isolation = ['--offline', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-extensions'];

const surviving = (dir) => readdirSync(dir).filter(name => name.endsWith('.jsonl')).length;

/** Open one session of a fresh synthetic tree and replay a key script against it. */
function driveTree(name, active, script) {
  const agent = profile(`${name}-`);
  const tree = sessionTree(join(agent, 'tree'));
  const result = drivePi(
    [...entries, ...isolation, '--session', tree[active], '--session-dir', tree.sessions],
    script,
    { PI_CODING_AGENT_DIR: agent },
    60,
    tree.proj,
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout.slice(-3000)}`);
  return { tree, output: result.stdout };
}

// `[Extensions]` is the first startup output that proves Pi loaded both entries.
const loaded = '[Extensions]';
const cascadeOffered = 'Delete current + 3 descendants';
const exitPi = { expect: '(auto)', send: '\u0004' };

test('cancelling /delete keeps every session in the tree', { timeout: 120000 }, () => {
  const { tree } = driveTree('cancel', 'main', [
    { expect: loaded, send: '/delete\r' },
    { expect: cascadeOffered, send: '\u001b' },
    exitPi,
  ]);
  assert.equal(surviving(tree.sessions), 4, 'cancel must not delete anything');
  assert.ok(existsSync(tree.main));
});

test('/delete removes only the current session by default', { timeout: 120000 }, () => {
  const { tree } = driveTree('current', 'main', [
    { expect: loaded, send: '/delete\r' },
    { expect: cascadeOffered, send: '\r' },
  ]);
  assert.equal(existsSync(tree.main), false, 'the current session must be gone after exit');
  assert.deepEqual(
    [tree.childA, tree.childB, tree.grandchild].map(existsSync),
    [true, true, true],
    'descendants survive a current-only delete',
  );
});

test('/delete cascades the whole descendant subtree when chosen', { timeout: 120000 }, () => {
  const { tree } = driveTree('cascade', 'main', [
    { expect: loaded, send: '/delete\r' },
    { expect: cascadeOffered, send: '\u001b[B' },
    { expect: '(auto)', send: '\r' },
  ]);
  assert.equal(surviving(tree.sessions), 0, 'cascade removes the session and all descendants');
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
    { expect: 'Deleted 3 sessions', send: '\u001b' },
    exitPi,
  ]);
  // The key and its label are separate colour spans, so only the label is matchable.
  assert.match(output, /subtree/, 'pi-delete must add its hint to Pi\'s own confirmation line');
  assert.deepEqual(
    { main: existsSync(tree.main), childA: existsSync(tree.childA), childB: existsSync(tree.childB), grandchild: existsSync(tree.grandchild) },
    { main: false, childA: true, childB: false, grandchild: false },
    'everything but the active session goes, and the active session is held back',
  );
});

test('both extensions install, group, expand and restore across repeated reloads', { timeout: 240000 }, () => {
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
  assert.equal(report.reloads, reloads);
  assert.equal(report.groupedCalls, 3);
  assert.match(report.collapsed, /bash ×3/);
});
