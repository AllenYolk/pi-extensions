import assert from 'node:assert/strict';
import { test } from 'node:test';
import { announcement, describeFailure, UNOBSERVED_RESPONSE } from '../src/degradation.ts';

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
  const lines = announcement({ summarizer: 'p/m (anthropic-messages)', reason: 'because' });
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

  // The guidance has to name every level the command accepts, and the third knob.
  assert.match(lines[4], /Next: \/compaction model provider\/model/);
  assert.match(lines[4], /thinking off\|minimal\|low\|medium\|high\|xhigh\|max/);
  assert.match(lines[4], /\/compaction window <tokens>/);
  assert.match(lines[4], /\/compaction disable/);
});
