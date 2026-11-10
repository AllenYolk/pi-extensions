import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateTokens, SessionManager } from '@earendil-works/pi-coding-agent';
import { workspace } from '../../../test/pi-collection.mjs';
import { join } from 'node:path';
import { DEFAULT_NEVER_PRUNE } from '../src/config.ts';
import {
  ARGUMENT_DIGEST_CHARS,
  CACHE_TTL_FALLBACK_MS,
  editedTargets,
  evaluatePruneGate,
  hostCompactionTrigger,
  isCompactionImminent,
  lastRequest,
  placeholder,
  PLACEHOLDER_EXCERPT_CHARS,
  planPrune,
} from '../src/prune.ts';

const ZERO_USAGE = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const usage = (cacheRead, cacheWrite) => ({
  input: 10, output: 20, cacheRead, cacheWrite, totalTokens: 30 + cacheRead + cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

/**
 * A session built through the host's own manager, so the projection under test is the host's.
 * Every tool call gets a result, so an orphaned call can only come from the code under test.
 */
function buildSession({ turns = 6, resultTokens = 400, tools = ['read', 'bash'] } = {}) {
  const root = workspace('prune-unit-');
  const session = SessionManager.create(join(root, 'proj'), join(root, 'sessions'));
  const ids = [];
  for (let turn = 0; turn < turns; turn++) {
    session.appendMessage({ role: 'user', content: `MARK-u${turn}`, timestamp: Date.now() });
    const name = tools[turn % tools.length];
    session.appendMessage({
      role: 'assistant',
      content: [{ type: 'toolCall', id: `call-${turn}`, name, arguments: { path: `/fixture/${turn}.ts`, note: 'x'.repeat(400) } }],
      timestamp: Date.now(),
      provider: 'minimax-cn',
      model: 'pi-compaction-conversation',
      usage: turn === turns - 1 ? usage(0, 5_000) : ZERO_USAGE,
      stopReason: 'toolUse',
    });
    ids.push(session.appendMessage({
      role: 'toolResult',
      toolCallId: `call-${turn}`,
      toolName: name,
      content: [{ type: 'text', text: `MARK-r${turn} ${'y'.repeat(resultTokens * 4)}` }],
      isError: false,
      timestamp: Date.now(),
    }));
  }
  return { session, ids };
}

const project = (session) => session.buildSessionProjection();

test('a placeholder names the tool, digests the arguments, states the omission and bounds the excerpt', () => {
  const original = `HEAD ${'z'.repeat(5_000)}`;
  const built = placeholder('read', [{ type: 'text', text: original }], { arguments: { path: '/a.ts', limit: 20 } });
  assert.match(built.text, /^\[pi-compaction pruned this tool result\]$/m);
  assert.match(built.text, /^Tool: read$/m);
  assert.match(built.text, /^Arguments: \{"path":"\/a\.ts","limit":20\}$/m);
  assert.match(built.text, /^Omitted: 4405 of 5005 characters\.$/m);
  assert.match(built.text, /Re-run `read` with those arguments to recover the full result/);
  assert.ok(built.text.includes(original.slice(0, PLACEHOLDER_EXCERPT_CHARS)), 'the excerpt is the head of the original');
  assert.ok(!built.text.includes(original.slice(PLACEHOLDER_EXCERPT_CHARS + 1)), 'nothing past the excerpt survives');
  assert.ok(built.text.length < original.length, 'the placeholder is smaller than what it replaces');
});

test('the argument digest is bounded and says where the full arguments are', () => {
  const built = placeholder('read', [{ type: 'text', text: 'x'.repeat(4_000) }], {
    arguments: { blob: 'a'.repeat(4_000) },
  });
  const line = built.text.split('\n').find((candidate) => candidate.startsWith('Arguments: '));
  assert.ok(line.length < ARGUMENT_DIGEST_CHARS + 200, line.length);
  assert.match(line, /… \(truncated; the full arguments are on the preserved tool call\)$/);
});

test('a placeholder without a matching tool call points at the preserved one, and reports dropped blocks', () => {
  const built = placeholder('codemode', [{ type: 'image', data: 'x' }, { type: 'text', text: 'out' }], undefined);
  assert.match(built.text, /^Arguments: see the preserved tool call above$/m);
  assert.match(built.text, /^Non-text content dropped: 1 block\(s\)\.$/m);
});

test('a prune is a replacement, never an omission', () => {
  const { session } = buildSession({ tools: ['read'] });
  const plan = planPrune({
    entries: project(session).entries,
    editedTargetIds: new Set(),
    neverPrune: DEFAULT_NEVER_PRUNE,
    pruneWindowTokens: 0,
  });
  assert.ok(plan.edits.length > 0);
  for (const edit of plan.edits) {
    assert.equal(edit.type, 'context_edit');
    assert.notEqual(edit.replacement, null, 'null omits the entry and orphans the tool call');
    assert.ok(Array.isArray(edit.replacement.content));
    assert.equal(edit.replacement.content[0].type, 'text');
  }
  // Every tool call still has its result in the projection the edits produce.
  session.appendContextEdit(plan.edits[0].targetId, plan.edits[0].replacement);
  const after = project(session);
  const calls = after.messages.flatMap((message) =>
    message.role === 'assistant' && Array.isArray(message.content)
      ? message.content.filter((block) => block.type === 'toolCall').map((block) => block.id)
      : []);
  const results = new Set(after.messages.filter((message) => message.role === 'toolResult').map((message) => message.toolCallId));
  assert.deepEqual(calls.filter((id) => !results.has(id)), [], 'no orphaned tool call');
});

test('a result on the never-prune list is never pruned, whatever its size or age', () => {
  const { session, ids } = buildSession({ turns: 6, tools: ['read', 'bash'] });
  const plan = planPrune({
    entries: project(session).entries,
    editedTargetIds: new Set(),
    neverPrune: DEFAULT_NEVER_PRUNE,
    pruneWindowTokens: 0,
  });
  const branch = session.getBranch();
  const bashIds = branch
    .filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'bash')
    .map((entry) => entry.id);
  assert.ok(bashIds.length > 0);
  assert.deepEqual(plan.prunedEntryIds.filter((id) => bashIds.includes(id)), []);
  assert.ok(plan.prunedEntryIds.length > 0, 'the read results are still pruned');
  assert.equal(plan.prunedEntryIds.length + bashIds.length, ids.length);
  // The list is enforced by name, so a tool the list does not name is prunable.
  const open = planPrune({
    entries: project(session).entries,
    editedTargetIds: new Set(),
    neverPrune: [],
    pruneWindowTokens: 0,
  });
  assert.equal(open.prunedEntryIds.length, ids.length);
});

test('the window protects the newest tool results and prunes everything older', () => {
  const { session, ids } = buildSession({ turns: 6, resultTokens: 400, tools: ['read'] });
  const entries = project(session).entries;
  // Per-result token sizes, newest last, so a window can be set to protect an exact number of them.
  const each = entries
    .flatMap((entry) => entry.messages.filter((message) => message.role === 'toolResult'))
    .map((message) => estimateTokens(message));
  const resultTokens = each.reduce((sum, tokens) => sum + tokens, 0);
  const newest = (count) => each.slice(ids.length - count).reduce((sum, tokens) => sum + tokens, 0);

  // Nothing is pruned when the window covers every result.
  const none = planPrune({ entries, editedTargetIds: new Set(), neverPrune: [], pruneWindowTokens: resultTokens });
  assert.deepEqual(none.prunedEntryIds, []);

  // A window of zero protects nothing, including the newest result.
  const all = planPrune({ entries, editedTargetIds: new Set(), neverPrune: [], pruneWindowTokens: 0 });
  assert.deepEqual(all.prunedEntryIds, ids);

  // In between, exactly the results older than the window go, oldest first.
  for (const protect of [1, 2, 3]) {
    const plan = planPrune({
      entries, editedTargetIds: new Set(), neverPrune: [], pruneWindowTokens: newest(protect),
    });
    assert.deepEqual(plan.prunedEntryIds, ids.slice(0, ids.length - protect), `protecting ${protect}`);
  }
});

test('an already pruned result is not pruned again', () => {
  const { session, ids } = buildSession({ turns: 4, tools: ['read'] });
  const entries = project(session).entries;
  const first = planPrune({ entries, editedTargetIds: new Set(), neverPrune: [], pruneWindowTokens: 0 });
  assert.deepEqual(first.prunedEntryIds, ids);

  session.appendContextEdit(ids[0], { content: [{ type: 'text', text: 'already pruned' }] });
  const again = planPrune({
    entries: project(session).entries,
    editedTargetIds: editedTargets(session.getBranch()),
    neverPrune: [],
    pruneWindowTokens: 0,
  });
  assert.deepEqual(again.prunedEntryIds, ids.slice(1));
});

test('a placeholder that would not be smaller is not a prune', () => {
  const { session } = buildSession({ turns: 2, resultTokens: 1, tools: ['read'] });
  const plan = planPrune({
    entries: project(session).entries,
    editedTargetIds: new Set(),
    neverPrune: [],
    pruneWindowTokens: 0,
  });
  assert.deepEqual(plan.edits, [], 'a two-character result is not worth replacing with a placeholder');
});

test('a warm cache blocks the prune and a cold one permits it', () => {
  const now = 1_000_000_000;
  const warm = evaluatePruneGate({ usage: { cacheRead: 40_000, cacheWrite: 900 }, timestamp: now }, false, now);
  assert.equal(warm.armed, false);
  assert.equal(warm.gate, undefined);
  assert.match(warm.detail, /read 40000 cached prompt tokens/);

  const cold = evaluatePruneGate({ usage: { cacheRead: 0, cacheWrite: 40_000 }, timestamp: now }, false, now);
  assert.equal(cold.armed, true);
  assert.equal(cold.gate, 'cache-miss');
  assert.match(cold.detail, /already cold/);
});

test('an imminent compaction permits the prune whatever the cache is doing', () => {
  const now = 1_000_000_000;
  for (const cache of [{ cacheRead: 40_000, cacheWrite: 0 }, { cacheRead: 0, cacheWrite: 40_000 }]) {
    const gate = evaluatePruneGate({ usage: cache, timestamp: now }, true, now);
    assert.equal(gate.armed, true);
    assert.equal(gate.gate, 'compaction-imminent');
  }
  // Even with no observation at all.
  const blind = evaluatePruneGate(undefined, true, now);
  assert.equal(blind.armed, true);
  assert.equal(blind.gate, 'compaction-imminent');
});

test('the clock applies only when the request reported no cache usage', () => {
  const now = 1_000_000_000;
  const stale = now - CACHE_TTL_FALLBACK_MS - 1_000;
  const fresh = now - 1_000;

  const fallback = evaluatePruneGate({ timestamp: stale }, false, now);
  assert.equal(fallback.armed, true);
  assert.equal(fallback.gate, 'cache-ttl-fallback');
  assert.match(fallback.detail, /no cache usage/);

  assert.equal(evaluatePruneGate({ timestamp: fresh }, false, now).armed, false);
  // A warm cache is never overridden by the clock, however old the request is.
  const warm = evaluatePruneGate({ usage: { cacheRead: 10, cacheWrite: 0 }, timestamp: stale }, false, now);
  assert.equal(warm.armed, false);
  assert.equal(warm.gate, undefined);
  // And with nothing observed at all, nothing is armed.
  const none = evaluatePruneGate(undefined, false, now);
  assert.equal(none.armed, false);
  assert.match(none.detail, /no completed request/);
});

test('the last request observation is the newest assistant message with usable usage', () => {
  const { session } = buildSession({ turns: 3, tools: ['read'] });
  const observed = lastRequest(project(session).entries);
  assert.deepEqual(observed.usage, { cacheRead: 0, cacheWrite: 5_000 });

  // An aborted assistant message carries no usable usage, so the one before it stays the observation.
  session.appendMessage({ role: 'user', content: 'again', timestamp: Date.now() });
  session.appendMessage({
    role: 'assistant', content: [{ type: 'text', text: 'stopped' }], timestamp: 7,
    provider: 'minimax-cn', model: 'pi-compaction-conversation', usage: usage(9, 9), stopReason: 'aborted',
  });
  assert.deepEqual(lastRequest(project(session).entries).usage, { cacheRead: 0, cacheWrite: 5_000 });
  // With no usable usage anywhere, there is no observation and the clock fallback cannot apply.
  assert.equal(lastRequest([]), undefined);
});

test('imminence is the host\'s own threshold test, resolved the way the host resolves it', () => {
  const trigger = hostCompactionTrigger({ compaction: { reserveTokens: 32_768 } }, undefined);
  assert.deepEqual(trigger, { enabled: true, reserveTokens: 32_768 });
  assert.equal(isCompactionImminent({ tokens: 200_000, contextWindow: 200_000, percent: 100 }, trigger), true);
  assert.equal(isCompactionImminent({ tokens: 100_000, contextWindow: 200_000, percent: 50 }, trigger), false);
  // Unknown tokens, and a host with compaction switched off, are both not imminent.
  assert.equal(isCompactionImminent({ tokens: null, contextWindow: 200_000, percent: null }, trigger), false);
  assert.equal(isCompactionImminent(undefined, trigger), false);
  assert.equal(isCompactionImminent(
    { tokens: 200_000, contextWindow: 200_000, percent: 100 },
    hostCompactionTrigger({ compaction: { enabled: false } }, undefined),
  ), false);

  // A per-model override wins over the ordinary setting, as it does in the host.
  const overridden = hostCompactionTrigger(
    { compaction: { reserveTokens: 1_000, modelOverrides: { 'p/m': { reserveTokens: 150_000 } } } },
    { provider: 'p', id: 'm' },
  );
  assert.equal(overridden.reserveTokens, 150_000);
  assert.equal(hostCompactionTrigger({}, undefined).reserveTokens, 16_384, 'the built-in default');
});
