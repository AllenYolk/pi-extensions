import assert from 'node:assert/strict';
import { test } from 'node:test';
import { announcement, describeFailure, UNOBSERVED_RESPONSE } from '../src/degradation.ts';

test('a failure is described from the response, not from the host\'s prose', () => {
  assert.match(describeFailure({ stopReason: 'stop', toolCall: true }, new Error('x')), /tried to call a tool/);
  assert.match(describeFailure({ stopReason: 'error', toolCall: false }, new Error('boom')), /reported an error \(boom\)/);
  assert.match(describeFailure({ stopReason: 'aborted', toolCall: false }, new Error('x')), /stopped with "aborted" instead of finishing/);
  assert.match(describeFailure(undefined, new Error('boom')), /did not produce a summary \(boom\)/);
});

test('an unobserved attempt has its own sentence', () => {
  // Distinct from the unobserved case above, which has a thrown error to quote: here compact()
  // handed a summary back and this package never saw the responses that produced it.
  assert.match(UNOBSERVED_RESPONSE, /never observed/);
  assert.match(UNOBSERVED_RESPONSE, /cannot prove the summary is complete/);
  assert.doesNotMatch(UNOBSERVED_RESPONSE, /undefined/, 'no error to quote means no "undefined" in the message');
});

test('the announcement names the preset, the reason, the new behaviour and its cost', () => {
  const lines = announcement({ preset: 'balanced', summarizer: 'p/m (anthropic-messages)', reason: 'because' });
  assert.equal(lines.length, 5);
  assert.match(lines[0], /degraded — compaction handed back to stock Pi/);
  assert.equal(lines[1], 'Preset: balanced — summarizer p/m (anthropic-messages)');
  assert.equal(lines[2], 'Why: because');
  assert.match(lines[3], /Now: stock Pi sends no output ceiling at all/);
  assert.match(lines[3], /3,437 to 26,019 tokens across 16 compactions/);
  assert.match(lines[4], /Next: \/compaction preset fast/);
});
