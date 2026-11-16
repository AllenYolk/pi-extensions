import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_COMPACTION_SETTINGS, SessionManager } from '@earendil-works/pi-coding-agent';
import { longSession, workspace } from '../../../test/pi-collection.mjs';

/**
 * The hook driven directly, for the failure classes a real host run cannot decide.
 *
 * Two of them. `checkHostSeam` probes the host's own `compact()` and the host this package is
 * developed against passes, so a seam mismatch is unreachable from the packaged-CLI runs in
 * `cli.test.mjs`. And a cancelled compaction is refused by the host itself before it would call a
 * stream function, so a real run cannot tell this package's own guard apart from the host's — which
 * is exactly the guard that has to hold. The extension therefore takes the compact function it
 * probes *and* compacts with as a second argument, and this file supplies one that records what it
 * was asked to do.
 *
 * A disposable profile, in place before the module is loaded: the hook reads its configuration from
 * the agent directory the host reports.
 */
const agentDir = mkdtempSync(join(tmpdir(), 'pi-compaction-hook-'));
mkdirSync(join(agentDir, 'extensions/pi-compaction'), { recursive: true });
writeFileSync(join(agentDir, 'extensions/pi-compaction/config.json'), JSON.stringify({
  enabled: true,
  summarizerModel: 'fixture/primary',
  fallbackModel: 'fixture/fallback',
}));
process.env.PI_CODING_AGENT_DIR = agentDir;

const { default: piCompaction } = await import('../src/index.ts');

const MODELS = {
  'fixture/primary': { id: 'primary', provider: 'fixture', api: 'fixture', reasoning: false },
  'fixture/fallback': { id: 'fallback', provider: 'fixture', api: 'fixture', reasoning: false },
};

/** Every registry call the hook made, in order. A fallback attempt would show up here. */
function harness({ respond } = {}) {
  const calls = [];
  const handlers = new Map();
  const entries = [];
  const pi = {
    on: (event, handler) => handlers.set(event, handler),
    appendEntry: (customType, data) => entries.push({ customType, data }),
    // No retry, so one attempt is one stream call and the record is unambiguous.
    getSettings: () => ({ retry: { enabled: false } }),
    registerCommand: () => {},
  };
  const ctx = {
    hasUI: false,
    model: { id: 'conversation', provider: 'fixture', api: 'fixture' },
    sessionManager: { getSessionId: () => 'pi-compaction-hook-test', getBranch: () => [] },
    modelRegistry: {
      find: (provider, id) => { calls.push(`find ${provider}/${id}`); return MODELS[`${provider}/${id}`]; },
      hasConfiguredAuth: (model) => { calls.push(`auth ${model.id}`); return true; },
      streamSimple: (model, _context, _options) => {
        calls.push(`streamSimple ${model.id}`);
        return { result: async () => (respond ?? (() => ({ role: 'assistant', content: [], stopReason: 'stop' })))(model) };
      },
    },
  };
  return { pi, ctx, handlers, entries, calls };
}

const dirs = workspace('pi-compaction-hook-');
const branch = longSession(SessionManager, { cwd: join(dirs, 'proj'), sessionDir: join(dirs, 'sessions'), turns: 40, turnTokens: 1_500 })
  .session.getBranch();

const compactionEvent = (signal) => ({
  branchEntries: branch,
  preparation: {
    firstKeptEntryId: 'host',
    messagesToSummarize: [],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 123,
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    settings: DEFAULT_COMPACTION_SETTINGS,
  },
  customInstructions: undefined,
  signal,
});

/**
 * A host compact function that satisfies the seam probe — arity 12, the supplied stream function is
 * called with options, its `result()` is awaited, and the retry policy in the tenth argument drives
 * a second call — and records every compaction it was asked to run.
 */
function fakeHost() {
  const compactions = [];
  const fn = async (
    preparation, model, _apiKey, _headers, _instructions, signal, _thinking, streamFn, _extra, retry,
  ) => {
    compactions.push(`${model.provider}/${model.id}`);
    const allowed = retry?.enabled ? 1 + (retry.maxRetries ?? 0) : 1;
    let message;
    for (let index = 0; index < allowed; index++) {
      const stream = await streamFn(model, { messages: preparation.messagesToSummarize ?? [] }, { signal });
      message = await stream.result();
      if (message?.stopReason !== 'error') break;
    }
    return { summary: 'fake summary', firstKeptEntryId: preparation.firstKeptEntryId, tokensBefore: 0 };
  };
  Object.defineProperty(fn, 'length', { value: 12 });
  return { fn, compactions };
}

/** Silence the announcement the hook prints for a handback; the record is what is asserted on. */
async function quietly(run) {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

test('a host seam mismatch attempts nothing, not even the configured fallback', async () => {
  const { pi, ctx, handlers, entries, calls } = harness();
  // A compaction function that records what it was asked to do, with the wrong shape for this
  // package's host: too few parameters, so the probe refuses it on arity before calling it. If the
  // candidate loop were ever entered on this path, `compactions` would show it.
  const host = fakeHost();
  Object.defineProperty(host.fn, 'length', { value: 9 });
  piCompaction(pi, host.fn);

  const result = await quietly(async () => {
    handlers.get('session_start')({}, ctx);
    const outcome = await handlers.get('session_before_compact')(compactionEvent(new AbortController().signal), ctx);
    handlers.get('session_compact')({}, ctx);
    return outcome;
  });

  // Nothing about a second model fixes a seam the first one cannot use, and two failed attempts
  // would make the announcement worse. These come first so that breaking the early return fails on
  // the attempt itself rather than on the shape of the result.
  assert.deepEqual(
    calls.filter((call) => call.startsWith('streamSimple')),
    [],
    'the fallback stream function was never called',
  );
  assert.deepEqual(
    calls.filter((call) => call.startsWith('find') || call.startsWith('auth')),
    [],
    'no model was resolved — not the summarizer, and not the fallback',
  );
  assert.deepEqual(host.compactions, [], 'and no compaction was started at all');
  assert.equal(result, undefined, 'a seam mismatch hands back to the host');
  assert.equal(entries.length, 1, 'the handback is recorded');
  assert.equal(entries[0].customType, 'pi-compaction-degradation');
  assert.equal(entries[0].data.attempts.length, 1, 'the seam is one attempt that never ran');
  assert.match(entries[0].data.attempts[0].reason, /host seam mismatch/);
});

test('a cut point with nothing to summarise attempts no fallback either', async () => {
  // The other path the issue lists under "explicitly not". There is no request to make, so a second
  // model has nothing to do about it — and a fallback attempted here would summarise a range the
  // package has already decided is empty.
  const dir = mkdtempSync(join(tmpdir(), 'pi-compaction-nothing-'));
  mkdirSync(join(dir, 'extensions/pi-compaction'), { recursive: true });
  writeFileSync(join(dir, 'extensions/pi-compaction/config.json'), JSON.stringify({
    enabled: true,
    summarizerModel: 'fixture/primary',
    fallbackModel: 'fixture/fallback',
    // Larger than the whole session, so the cut point is its start and nothing is above it.
    keptWindowTokens: 1_000_000,
  }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const { pi, ctx, handlers, entries, calls } = harness();
  const host = fakeHost();
  try {
    piCompaction(pi, host.fn);
    const result = await quietly(async () => {
      handlers.get('session_start')({}, ctx);
      const outcome = await handlers.get('session_before_compact')(compactionEvent(new AbortController().signal), ctx);
      handlers.get('session_compact')({}, ctx);
      return outcome;
    });

    // The primary is resolved before the cut point is known, so it appears; the fallback is never
    // reached at all. Asserted before the result, so that breaking the early return fails on the
    // attempt itself.
    assert.deepEqual(calls.filter((call) => call.startsWith('find')), ['find fixture/primary']);
    assert.deepEqual(
      calls.filter((call) => call.startsWith('streamSimple')),
      [],
      'the fallback stream function was never called',
    );
    assert.deepEqual(
      host.compactions.filter((model) => !model.startsWith('pi-compaction-seam-probe')),
      [],
      'and no compaction was started',
    );
    assert.equal(result, undefined, 'it hands back');

    assert.equal(entries.length, 1, 'the handback is recorded');
    assert.equal(entries[0].customType, 'pi-compaction-degradation');
    assert.equal(entries[0].data.attempts.length, 1, 'the fallback was not attempted');
    assert.match(entries[0].data.attempts[0].reason, /the cut point leaves no history to summarise/);
  } finally {
    process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test('a cancellation never reaches the fallback stream function', async () => {
  // The primary answers with a response this package refuses — so the fallback is one branch away —
  // and the user cancels on that response. This host keeps calling whatever stream function it is
  // handed, so only this package's own guard can keep the fallback from running.
  const controller = new AbortController();
  const { pi, ctx, handlers, entries, calls } = harness({
    respond: () => {
      controller.abort();
      return { role: 'assistant', content: [{ type: 'text', text: 'PARTIAL' }], stopReason: 'aborted' };
    },
  });
  const host = fakeHost();
  piCompaction(pi, host.fn);

  const result = await quietly(async () => {
    handlers.get('session_start')({}, ctx);
    return handlers.get('session_before_compact')(compactionEvent(controller.signal), ctx);
  });

  assert.deepEqual(result, { cancel: true }, 'a cancellation is answered, not handed back');
  assert.deepEqual(host.compactions.filter((model) => !model.startsWith('pi-compaction-seam-probe')), ['fixture/primary'],
    'no second compaction was started');
  assert.deepEqual(calls.filter((call) => call.startsWith('streamSimple')), ['streamSimple primary'],
    'the fallback stream function was never called');
  assert.deepEqual(entries, [], 'and a cancellation is not recorded as an outcome');
});

test('a rejected configuration leaves the hook inert even with a fallback configured', async () => {
  // The whole-file rejection is the existing rule: a half-applied fallback is worse than none.
  const dir = mkdtempSync(join(tmpdir(), 'pi-compaction-rejected-'));
  mkdirSync(join(dir, 'extensions/pi-compaction'), { recursive: true });
  writeFileSync(join(dir, 'extensions/pi-compaction/config.json'), JSON.stringify({
    enabled: true,
    fallbackModel: 'no-slash',
  }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const { pi, ctx, handlers, entries, calls } = harness();
  const host = fakeHost();
  try {
    piCompaction(pi, host.fn);
    await quietly(async () => {
      handlers.get('session_start')({}, ctx);
      const result = await handlers.get('session_before_compact')(compactionEvent(new AbortController().signal), ctx);
      assert.equal(result, undefined, 'an inert package hands compaction back untouched');
      handlers.get('session_compact')({}, ctx);
    });
    assert.deepEqual(calls, [], 'nothing is resolved and nothing is requested');
    assert.deepEqual(host.compactions.filter((model) => !model.startsWith('pi-compaction-seam-probe')), [],
      'and no compaction is run');
    assert.deepEqual(entries, [], 'and nothing is recorded');
  } finally {
    process.env.PI_CODING_AGENT_DIR = previous;
  }
});
