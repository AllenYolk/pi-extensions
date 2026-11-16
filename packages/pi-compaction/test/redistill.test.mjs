import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redistillInstructions } from '../src/redistill.ts';

const THRESHOLDS = { aboveTokens: 4_000, targetTokens: 6_000 };
/** 16,000 characters is 4,000 tokens under the host's own chars/4 estimate for a summary. */
const BIG = 'x'.repeat(16_000);
const SMALL = 'x'.repeat(15_996);

test('off changes nothing, whatever the previous summary looks like', () => {
  assert.equal(redistillInstructions(BIG, null, undefined), undefined);
  assert.equal(redistillInstructions(BIG, null, 'focus on the failing test'), 'focus on the failing test');
  assert.equal(redistillInstructions(undefined, null, undefined), undefined);
});

test('the first compaction has nothing to re-distil', () => {
  for (const previous of [undefined, '']) {
    assert.equal(redistillInstructions(previous, THRESHOLDS, undefined), undefined, String(previous));
    assert.equal(redistillInstructions(previous, THRESHOLDS, 'user text'), 'user text', String(previous));
  }
});

test('a previous summary below aboveTokens injects nothing', () => {
  // 3,999 tokens against a threshold of 4,000.
  assert.equal(redistillInstructions(SMALL, THRESHOLDS, undefined), undefined);
  assert.equal(redistillInstructions(SMALL, THRESHOLDS, 'user text'), 'user text');
});

test('a previous summary at aboveTokens asks for a fixed point, naming both numbers', () => {
  const instruction = redistillInstructions(BIG, THRESHOLDS, undefined);
  assert.equal(typeof instruction, 'string');
  // The two placeholders are the measured previous summary and the configured target.
  assert.match(instruction, /The previous summary is 4000 tokens/);
  assert.match(instruction, /merged summary should stay under 6000\b/);
  // It names what may be dropped, rather than asking for brevity.
  assert.match(instruction, /Keep every goal, constraint, decision with its rationale, blocker, open question and next step that is still true\./);
  assert.match(instruction, /Drop an entry when a later entry supersedes it/);
  assert.match(instruction, /drop detail about work that is finished and no longer referenced/);
  assert.match(instruction, /Do not append a changelog and do not add a history section\./);
  // A model that ignores it must produce exactly today's summary, so nothing here bounds the response.
  assert.doesNotMatch(instruction, /max_tokens|truncat|ceiling/i);
});

test("a user's own /compact text is kept verbatim and ours is appended to it", () => {
  const user = 'focus on the failing test; keep the port number';
  const instruction = redistillInstructions(BIG, THRESHOLDS, user);
  assert.ok(instruction.startsWith(user), 'the user text is not modified and stays first');
  assert.ok(instruction.includes(user), 'and is present verbatim');
  assert.match(instruction, /The previous summary is 4000 tokens/);
  assert.notEqual(instruction, user);
});

test('the instruction is the same for every compaction at the same size', () => {
  // A fixed template in the source, not a prompt knob: the only variable parts are the two numbers.
  const first = redistillInstructions(BIG, THRESHOLDS, undefined);
  const second = redistillInstructions(BIG, { aboveTokens: 1, targetTokens: 6_000 }, undefined);
  assert.equal(first, second, 'aboveTokens decides whether to ask, not what to say');
  const other = redistillInstructions(BIG, { aboveTokens: 1, targetTokens: 4_000 }, undefined);
  assert.equal(other, first.replace('under 6000', 'under 4000'), 'only the named target differs');
});
