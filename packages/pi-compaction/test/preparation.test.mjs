import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { estimateTokens, DEFAULT_COMPACTION_SETTINGS, SessionManager, buildSessionProjection, findCutPoint } from '@earendil-works/pi-coding-agent';
import { longSession, workspace } from '../../../test/pi-collection.mjs';
import { fileListChars, MAX_FILE_LIST_ENTRIES, prepareCompaction } from '../src/preparation.ts';

const hostPreparation = (fileOps = { read: new Set(), written: new Set(), edited: new Set() }, previousSummary) => ({
  firstKeptEntryId: 'host',
  messagesToSummarize: [],
  turnPrefixMessages: [],
  isSplitTurn: false,
  tokensBefore: 123,
  previousSummary,
  fileOps,
  settings: DEFAULT_COMPACTION_SETTINGS,
});

const markersIn = (messages) =>
  new Set(messages.flatMap((message) => JSON.stringify(message.content ?? '').match(/MARK-[uar]\d+/g) ?? []));

const box = (name) => {
  const root = workspace(`${name}-`);
  return { cwd: join(root, 'proj'), sessionDir: join(root, 'sessions') };
};

function built(turns = 40, turnTokens = 1_500) {
  const dirs = box('prep-');
  const session = longSession(SessionManager, { ...dirs, turns, turnTokens });
  return { session, branch: session.session.getBranch() };
}

const tokensOf = (branch, fromId) => {
  const start = branch.findIndex((entry) => entry.id === fromId);
  return branch
    .slice(start)
    .flatMap((entry) => (entry.type === 'message' ? [entry.message] : []))
    .reduce((sum, message) => sum + estimateTokens(message), 0);
};

test('the kept window follows our own token target rather than the host setting', () => {
  const { session, branch } = built();
  const largestEntry = Math.max(
    ...branch.filter((entry) => entry.type === 'message').map((entry) => estimateTokens(entry.message)),
  );
  const hostDefault = DEFAULT_COMPACTION_SETTINGS.keepRecentTokens;
  for (const target of [4_000, 16_000, 40_000]) {
    const prepared = prepareCompaction(branch, hostPreparation(), target);
    const kept = tokensOf(session.session.getBranch(), prepared.firstKeptEntryId);
    assert.ok(kept <= target + largestEntry, `target ${target} kept ${kept}`);
    assert.ok(kept >= target - 2 * largestEntry, `target ${target} kept ${kept}`);
  }
  const ours = tokensOf(branch, prepareCompaction(branch, hostPreparation(), 16_000).firstKeptEntryId);
  const hosts = tokensOf(branch, prepareCompaction(branch, hostPreparation(), hostDefault).firstKeptEntryId);
  assert.ok(ours < hosts, `our 16,000-token window (${ours}) must be smaller than the host's ${hostDefault}-token one (${hosts})`);
});

test('nothing between the summarised range and our cut point is lost', () => {
  for (const target of [2_000, 4_000, 16_000, 40_000]) {
    const { branch } = built();
    const prepared = prepareCompaction(branch, hostPreparation(), target);
    const cutIndex = branch.findIndex((entry) => entry.id === prepared.firstKeptEntryId);
    const summarised = markersIn([...prepared.messagesToSummarize, ...prepared.turnPrefixMessages]);
    const kept = markersIn(
      branch.slice(cutIndex).flatMap((entry) => (entry.type === 'message' ? [entry.message] : [])),
    );
    const above = markersIn(
      branch.slice(0, cutIndex).flatMap((entry) => (entry.type === 'message' ? [entry.message] : [])),
    );
    assert.equal(above.size + kept.size, 120, `target ${target}: the cut point splits the session, it does not drop any of it`);
    const lost = [...above].filter((marker) => !summarised.has(marker));
    assert.deepEqual(lost, [], `target ${target} lost messages above the cut point`);
    const duplicated = [...summarised].filter((marker) => kept.has(marker));
    assert.deepEqual(duplicated, [], `target ${target} summarised a message it also kept`);
    assert.equal(summarised.size + kept.size, 120, `target ${target}: summarised plus kept is the whole session`);
  }
});

test('a cut inside a turn keeps the turn prefix in its own summarised range', () => {
  // The budget is only exceeded by the trailing tool result, which is the case the host's own cut
  // point resolves to the preceding assistant tool call — a split turn.
  const dirs = box('prep-split-');
  const session = SessionManager.create(dirs.cwd, dirs.sessionDir);
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  for (let turn = 0; turn < 6; turn++) {
    session.appendMessage({ role: 'user', content: `MARK-u${turn} ${'x'.repeat(800)}`, timestamp: Date.now() });
    session.appendMessage({
      role: 'assistant', content: [{ type: 'text', text: `MARK-a${turn}` }], timestamp: Date.now(),
      provider: 'minimax-cn', model: 'pi-compaction-conversation', usage, stopReason: 'stop',
    });
  }
  session.appendMessage({ role: 'user', content: 'MARK-utail', timestamp: Date.now() });
  session.appendMessage({
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'big', name: 'read', arguments: { path: '/fixture/big.ts' } }],
    timestamp: Date.now(), provider: 'minimax-cn', model: 'pi-compaction-conversation', usage, stopReason: 'toolUse',
  });
  session.appendMessage({
    role: 'toolResult', toolCallId: 'big', toolName: 'read',
    content: [{ type: 'text', text: `MARK-rtail ${'x'.repeat(80_000)}` }], isError: false, timestamp: Date.now(),
  });

  const branch = session.getBranch();
  const prepared = prepareCompaction(branch, hostPreparation(), 19_000);
  assert.equal(prepared.isSplitTurn, true);
  assert.ok(prepared.turnPrefixMessages.length > 0);
  const history = markersIn(prepared.messagesToSummarize);
  const prefix = markersIn(prepared.turnPrefixMessages);
  assert.equal([...prefix].filter((marker) => history.has(marker)).length, 0, 'the two ranges must not overlap');
  const cutIndex = branch.findIndex((entry) => entry.id === prepared.firstKeptEntryId);
  const above = markersIn(branch.slice(0, cutIndex).flatMap((entry) => (entry.type === 'message' ? [entry.message] : [])));
  assert.deepEqual([...above].filter((marker) => !history.has(marker) && !prefix.has(marker)), []);
});

test('the file blocks are capped', () => {
  const { branch } = built();
  const many = (prefix, count) => new Set(Array.from({ length: count }, (_, index) => `${prefix}-${index}.ts`));
  const prepared = prepareCompaction(
    branch,
    hostPreparation({ read: many('read', 300), written: many('write', 300), edited: many('edit', 300) }),
    16_000,
  );
  assert.equal(prepared.fileOps.read.size, MAX_FILE_LIST_ENTRIES);
  assert.equal(prepared.fileOps.written.size, MAX_FILE_LIST_ENTRIES);
  assert.equal(prepared.fileOps.edited.size, MAX_FILE_LIST_ENTRIES);
});

test('a native compaction\'s file lists are not carried into ours', () => {
  const dirs = box('prep-native-');
  const session = SessionManager.create(dirs.cwd, dirs.sessionDir);
  const entries = [];
  for (let turn = 0; turn < 6; turn++) {
    entries.push(session.appendMessage({ role: 'user', content: `MARK-u${turn} ${'x'.repeat(400)}`, timestamp: Date.now() }));
    entries.push(session.appendMessage({
      role: 'assistant',
      content: [{ type: 'toolCall', id: `read-${turn}`, name: 'read', arguments: { path: `/after/read-${turn}.ts` } }],
      timestamp: Date.now(), provider: 'minimax-cn', model: 'pi-compaction-conversation',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'toolUse',
    }));
  }
  session.appendCompaction('native summary', entries[2], 1_000, {
    readFiles: ['/before/read-a.ts', '/before/read-b.ts'],
    modifiedFiles: ['/before/edit-a.ts'],
  }, false);

  const branch = session.getBranch();
  // The host seeds its own file operations from a native compaction's details; we drop that seed.
  const prepared = prepareCompaction(branch, hostPreparation({
    read: new Set(['/before/read-a.ts', '/before/read-b.ts', '/after/read-5.ts']),
    written: new Set(),
    edited: new Set(['/before/edit-a.ts']),
  }, 'native summary'), 100);
  assert.deepEqual([...prepared.fileOps.read], ['/after/read-5.ts']);
  assert.deepEqual([...prepared.fileOps.edited], []);
  assert.equal(prepared.previousSummary, 'native summary');
});

test('a session with nothing above the cut point yields no preparation', () => {
  const { branch } = built(2, 200);
  assert.equal(prepareCompaction(branch, hostPreparation(), 100_000), undefined);
});

test('a split turn with no history above it yields no preparation', () => {
  // The host carries the previous summary forward verbatim and appends a fresh turn prefix to it,
  // so the result can only grow and no budget this package sets can bound it.
  const dirs = box('prep-split-empty-');
  const session = SessionManager.create(dirs.cwd, dirs.sessionDir);
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  session.appendMessage({ role: 'user', content: `MARK-u0 ${'x'.repeat(400)}`, timestamp: Date.now() });
  const kept = session.appendMessage({ role: 'user', content: 'MARK-utail', timestamp: Date.now() });
  // The previous compaction keeps from the tail turn's own first message, so the boundary above it
  // is empty: that turn starts exactly where the previous compaction starts keeping.
  session.appendCompaction('PREVIOUS SUMMARY', kept, 1_000, { readFiles: [], modifiedFiles: [] }, false);
  session.appendMessage({
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'big', name: 'read', arguments: { path: '/fixture/big.ts' } }],
    timestamp: Date.now(), provider: 'minimax-cn', model: 'pi-compaction-conversation', usage, stopReason: 'toolUse',
  });
  session.appendMessage({
    role: 'toolResult', toolCallId: 'big', toolName: 'read',
    content: [{ type: 'text', text: `MARK-rtail ${'x'.repeat(80_000)}` }], isError: false, timestamp: Date.now(),
  });

  // Prove the shape before asserting on it: the cut lands inside the tail turn, and that turn
  // starts exactly at the previous compaction's boundary, so the history range is empty.
  const branch = session.getBranch();
  const sources = buildSessionProjection(branch).entries.map((entry) => entry.sourceEntry);
  const previous = sources.findIndex((entry) => entry.type === 'compaction');
  const cut = findCutPoint(sources, previous + 1, sources.length, 1_000);
  assert.equal(cut.isSplitTurn, true, 'the cut lands inside the tail turn');
  assert.equal(cut.turnStartIndex, previous + 1, 'and that turn starts at the previous compaction');

  assert.equal(prepareCompaction(branch, hostPreparation(), 1_000), undefined);
});

test('the file-list block the host appends is measured exactly', () => {
  // The budget is the model's and the host appends this block itself, so the acceptance test has to
  // measure the text alone. The expected strings are the host's own shape: read-only paths and
  // modified paths (edited ∪ written), each sorted, as two tagged blocks.
  const block = (tag, paths) => (paths.length === 0 ? '' : `\n\n<${tag}>\n${paths.join('\n')}\n</${tag}>`);
  const ops = (read, edited, written) => ({ read: new Set(read), edited: new Set(edited), written: new Set(written) });
  const cases = [
    [ops([], [], []), ''],
    [ops(['/b.ts', '/a.ts'], [], []), block('read-files', ['/a.ts', '/b.ts'])],
    [ops([], ['/e.ts'], ['/w.ts']), block('modified-files', ['/e.ts', '/w.ts'])],
    [ops(['/r.ts'], ['/e.ts'], ['/w.ts']), block('read-files', ['/r.ts']) + block('modified-files', ['/e.ts', '/w.ts'])],
    // A path that was both read and edited appears once, under modified.
    [ops(['/both.ts'], ['/both.ts'], []), block('modified-files', ['/both.ts'])],
  ];
  for (const [fileOps, expected] of cases) {
    const paths = [...fileOps.read, ...fileOps.edited, ...fileOps.written];
    assert.equal(fileListChars(fileOps), expected.length, JSON.stringify(paths));
  }
});
