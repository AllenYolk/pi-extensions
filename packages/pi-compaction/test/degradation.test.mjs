import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  announcement,
  describeFailure,
  describeRecord,
  FALLBACK_ENTRY,
  handedBack,
  toRecord,
  UNOBSERVED_RESPONSE,
} from '../src/degradation.ts';

const attempt = (summarizer, reason) => (reason === undefined ? { summarizer } : { summarizer, reason });

test('a failure is described from the response, not from the host\'s prose', () => {
  assert.match(describeFailure({ stopReason: 'stop', toolCall: true }, new Error('x')), /tried to call a tool/);
  assert.match(describeFailure({ stopReason: 'error', toolCall: false }, new Error('boom')), /reported an error \(boom\)/);
  assert.match(describeFailure({ stopReason: 'aborted', toolCall: false }, new Error('x')), /stopped with "aborted" instead of finishing/);
  assert.match(describeFailure(undefined, new Error('boom')), /did not produce a summary \(boom\)/);
});

test('a response with no recognised stop reason never reports "undefined"', () => {
  // `AttemptOutcome.stopReason` is optional — the response may carry none, or one this package does
  // not model. Quoting the string "undefined" at the user, and dropping the thrown error that is the
  // only real diagnostic, are both wrong.
  const noReason = { toolCall: false };
  assert.match(describeFailure(noReason, new Error('503 model_unavailable')), /did not produce a summary \(503 model_unavailable\)/);
  assert.doesNotMatch(describeFailure(noReason, new Error('503')), /undefined/);
  assert.match(describeFailure(noReason, undefined), /carried no stop reason, so the package cannot prove it finished/);
  assert.doesNotMatch(describeFailure(noReason, undefined), /undefined/);
  assert.doesNotMatch(describeFailure(undefined, undefined), /undefined/);
});

test('provider-originated text cannot rewrite the terminal', () => {
  // The announcement is written to the terminal and pinned as a widget. An error message carrying
  // control characters could rewrite the display, and a newline would break the one-fact-per-line
  // shape the announcement depends on.
  const hostile = { stopReason: 'error', toolCall: false };
  const reason = describeFailure(hostile, new Error('\u001b[2J\u001b[1;1Hcleared\nInjected: line two\ttabbed'));
  assert.doesNotMatch(reason, /[\u0000-\u001F\u007F-\u009F]/, 'no control characters survive');
  assert.equal(reason.includes('\n'), false, 'and no newline');
  assert.match(reason, /cleared Injected: line two tabbed/, 'the text is still there, flattened');

  // An unbounded message would push the rest of the announcement off the screen.
  const long = describeFailure(hostile, new Error('x'.repeat(5_000)));
  assert.ok(long.length < 400, `the quoted message is bounded, got ${long.length} characters`);
  assert.match(long, /…/, 'and says it was cut');

  // A stop reason is quoted the same way.
  assert.doesNotMatch(describeFailure({ stopReason: 'weird\u001b[31m', toolCall: false }, undefined), /[\u0000-\u001F]/);
});

test('an unobserved attempt has its own sentence', () => {
  // Distinct from the unobserved case above, which has a thrown error to quote: here compact()
  // handed a summary back and this package never saw the responses that produced it.
  assert.match(UNOBSERVED_RESPONSE, /never observed/);
  assert.match(UNOBSERVED_RESPONSE, /cannot prove the summary is complete/);
  assert.doesNotMatch(UNOBSERVED_RESPONSE, /undefined/, 'no error to quote means no "undefined" in the message');
});

test('the announcement names the summarizer, the reason and everything a handback gives up', () => {
  const lines = announcement({ attempts: [attempt('p/m (anthropic-messages)', 'because')] });
  assert.equal(lines.length, 5);
  assert.match(lines[0], /degraded — compaction handed back to stock Pi/);
  assert.equal(lines[1], 'Summarizer: p/m (anthropic-messages)');
  assert.equal(lines[2], 'Why: because');

  // A handback does not change the summary's length — this package sends no output ceiling and
  // neither does stock Pi. What it gives up is all three of the things this package controls, and
  // the cut point is the third: returning `undefined` from the hook means the host prepares its own
  // compaction with the host's recent-token setting, so the configured kept-window target is discarded.
  assert.match(lines[3], /Now: stock Pi compacts with the conversation model/);
  assert.match(lines[3], /the session's own thinking level/);
  assert.match(lines[3], /the host's recent-token setting rather than this package's kept-window target/);
  assert.match(lines[3], /The summary length is unaffected/);
  assert.match(lines[3], /neither path sends an output ceiling/);
  assert.match(lines[3], /those three are the whole of what this package controls/);

  // The guidance has to name every level the command accepts, and every knob. There are four knobs
  // now, and `fallback` leads because it is the one a reader most needs after a handback: it is the
  // only one that would have prevented it.
  assert.match(lines[4], /Next: \/compaction fallback provider\/model/);
  assert.match(lines[4], /\/compaction model provider\/model/);
  assert.match(lines[4], /thinking off\|minimal\|low\|medium\|high\|xhigh\|max/);
  assert.match(lines[4], /\/compaction window <tokens>/);
  assert.match(lines[4], /\/compaction disable/);
});

test('one attempt keeps the shape it had before a fallback existed', () => {
  // `fallbackModel: null` has to take the released path, and the announcement's shape is part of
  // that: five lines, no `Earlier:` line, and nothing that only reads correctly once a second model
  // has been tried. The guidance line is deliberately *not* frozen — it names the fallback knob now,
  // because that knob exists whether or not this session configured one.
  const record = { attempts: [attempt('p/m (api)', 'the summarizer reported an error (503)')] };
  assert.equal(handedBack(record), true);
  const lines = announcement(record);
  assert.equal(lines.length, 5);
  assert.doesNotMatch(lines.join('\n'), /^Earlier:/m);
  assert.doesNotMatch(lines.join('\n'), /recovered — the fallback summarizer/);
});

test('a handback after two attempts names both of them', () => {
  const record = {
    attempts: [
      attempt('primary/m (api)', 'the summarizer reported an error (503 model_unavailable)'),
      attempt('fallback/f (api)', 'the host has no configured credentials for it'),
    ],
  };
  assert.equal(handedBack(record), true);
  const lines = announcement(record);
  assert.match(lines[0], /degraded — compaction handed back to stock Pi/);
  assert.equal(lines[1], 'Summarizer: fallback/f (api)');
  assert.equal(lines[2], 'Why: the host has no configured credentials for it');
  assert.equal(lines[3], 'Earlier: primary/m (api) — the summarizer reported an error (503 model_unavailable)');
  assert.match(lines[4], /^Now: stock Pi compacts with the conversation model/);
  assert.match(lines[5], /^Next: /);
});

test('a fallback that produced the summary is not announced as a handback', () => {  // The record must not lie. A handback announcement after a *successful* fallback would say stock
  // Pi compacted the session when this package's own fallback wrote the summary.
  const record = {
    attempts: [
      attempt('primary/m (api)', 'the summarizer reported an error (503 model_unavailable)'),
      attempt('fallback/f (api)'),
    ],
  };
  assert.equal(handedBack(record), false);
  const lines = announcement(record);
  assert.doesNotMatch(lines.join('\n'), /handed back to stock Pi/, 'nothing claims a handback');
  assert.equal(lines[1], 'Summarizer: fallback/f (api)');
  assert.match(lines[2], /primary\/m \(api\)/);
  assert.match(lines[2], /503 model_unavailable/);
  assert.match(lines[2], /the fallback ran and its summary was complete/);
  assert.match(lines[3], /^Now: /);
  assert.doesNotMatch(lines[3], /stock Pi compacts with the conversation model/);
  // The cut point is shared; the thinking level is not, because it is clamped per model. Claiming
  // both here is the sentence this announcement used to get wrong.
  assert.match(lines[3], /over the same kept window/);
  assert.doesNotMatch(lines[3], /same thinking level/);
  assert.equal(lines.filter((line) => line.startsWith('Earlier:')).length, 0, 'Why: already names the failed attempt');
});

test('a fallback names the thinking level it actually ran at', () => {
  // The level is clamped **per model**: `clampThinkingLevel` falls back to a model's lowest
  // supported level, and to `off` for one that cannot reason at all. So a fallback need not run at
  // the level the primary would have, and an announcement claiming it did would be the exact lie the
  // rest of this file is built to avoid. This is the sentence a reader trusts most.
  const clamped = announcement({
    attempts: [
      attempt('primary/m (api)', 'the summarizer reported an error (503)'),
      { summarizer: 'fallback/f (api)', thinking: { level: 'high', clampedFrom: 'medium' } },
    ],
  });
  assert.match(clamped[3], /at thinking level high \(clamped from medium; the level is clamped per model\)/);
  assert.doesNotMatch(clamped.join('\n'), /same thinking level/, 'and never claims the level was unchanged');

  // An unclamped fallback still says which level ran, without a clamp note.
  const clean = announcement({
    attempts: [attempt('p/m (api)', 'x'), { summarizer: 'f/f (api)', thinking: { level: 'medium' } }],
  });
  assert.match(clean[3], /at thinking level medium/);
  assert.doesNotMatch(clean[3], /clamped/);

  // A record written before the level was carried makes no claim about it rather than a false one.
  const unknown = announcement({ attempts: [attempt('p/m (api)', 'x'), { summarizer: 'f/f (api)' }] });
  assert.doesNotMatch(unknown[3], /thinking level/);
});

test('the status line reports a handback and a fallback differently', () => {
  const one = { attempts: [attempt('p/m (api)', 'because')] };
  assert.equal(describeRecord(one), 'Last degradation: summarizer p/m (api) — because');

  const two = { attempts: [attempt('a/a (api)', 'first'), attempt('b/b (api)', 'second')] };
  assert.equal(describeRecord(two), 'Last degradation: summarizer b/b (api) — second (after a/a (api) — first)');

  const recovered = { attempts: [attempt('a/a (api)', 'first'), attempt('b/b (api)')] };
  const line = describeRecord(recovered);
  assert.match(line, /^Last compaction: /);
  assert.match(line, /b\/b \(api\)/);
  assert.match(line, /a\/a \(api\) — first/);
  assert.doesNotMatch(line, /Last degradation/);
});

test('a successful fallback is recorded under its own entry type', () => {
  // The entry type is read back by anything scanning the session, so it has to say which happened.
  assert.equal(FALLBACK_ENTRY, 'pi-compaction-fallback');
  assert.notEqual(FALLBACK_ENTRY, 'pi-compaction-degradation');
});

const EMPTY = { attempts: [] };

test('handedBack answers for a record with no attempt instead of throwing', () => {
  // The read path is closed today — `toRecord` never returns an empty record — but this predicate is
  // exported, and the surface it serves is the one that must never crash. An empty record is not a
  // handback: nothing in it failed.
  assert.equal(handedBack(EMPTY), false);
  assert.equal(handedBack({ attempts: [attempt('p/m (api)')] }), false);
  assert.equal(handedBack({ attempts: [attempt('p/m (api)', 'because')] }), true);
});

test('announcement answers for a record with no attempt instead of throwing', () => {
  // A session file carrying a hand-edited or truncated entry must not turn a diagnostic into a thrown
  // error, and the reader who needed the diagnostic is the one least able to recover from it.
  const lines = announcement(EMPTY);
  assert.ok(Array.isArray(lines), 'it returns lines rather than throwing');
  assert.ok(lines.every((line) => typeof line === 'string' && line.length > 0));
  // And it guesses neither way: an empty record cannot say whether this package summarised or handed
  // back, so it must not claim either.
  assert.doesNotMatch(lines.join('\n'), /handed back to stock Pi/);
  assert.doesNotMatch(lines.join('\n'), /the fallback summarizer produced the summary/);
  assert.match(lines.join('\n'), /no attempt/);
});

test('describeRecord answers for a record with no attempt instead of throwing', () => {
  const line = describeRecord(EMPTY);
  assert.equal(typeof line, 'string');
  assert.ok(line.length > 0);
  assert.match(line, /no attempt/);
  assert.doesNotMatch(line, /Last degradation: summarizer /, 'it names no summarizer, because none was recorded');
});

test('a record written by 0.2.1 is normalised, not skipped', () => {
  // 0.2.1 recorded one attempt as `{ summarizer, reason }`. A session outlives the version that
  // compacted it, and the custom entry is the half of the announcement that survives a restart — so
  // a handback that was recorded has to stay readable, not merely not crash the reader.
  const legacy = toRecord({ summarizer: 'p/m (api)', reason: 'the summarizer reported an error (503)' });
  assert.deepEqual(legacy, { attempts: [{ summarizer: 'p/m (api)', reason: 'the summarizer reported an error (503)' }] });
  assert.equal(handedBack(legacy), true, 'a legacy record is a handback');
  assert.equal(describeRecord(legacy), 'Last degradation: summarizer p/m (api) — the summarizer reported an error (503)');
  assert.equal(announcement(legacy)[0], 'degraded — compaction handed back to stock Pi');

  // The current shape passes through untouched.
  const current = { attempts: [{ summarizer: 'a', reason: 'x' }, { summarizer: 'b' }] };
  assert.deepEqual(toRecord(current), current);

  // And nothing that is not a record is invented into one.
  assert.equal(toRecord(undefined), undefined);
  assert.equal(toRecord({ attempts: [] }), undefined, 'an empty attempt list is not a record');
  assert.equal(toRecord({ summarizer: 'p/m' }), undefined, 'half a legacy record is not a record');
  assert.equal(toRecord({ reason: 'x' }), undefined);
  assert.equal(toRecord('pi-compaction-degradation'), undefined);
});
