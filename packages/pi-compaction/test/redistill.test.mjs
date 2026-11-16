import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkTokenSeam,
  previousSummaryTokens,
  redistillFor,
  redistillInstructions,
  redistillStatus,
} from '../src/redistill.ts';

const THRESHOLDS = { aboveTokens: 4_000, targetTokens: 6_000 };
/** 16,000 characters is 4,000 tokens under the host's own chars/4 estimate for a summary. */
const BIG = 'x'.repeat(16_000);
const SMALL = 'x'.repeat(15_996);

test('off changes nothing, whatever the previous summary looks like', () => {
  assert.equal(redistillInstructions(BIG, null, undefined, false), undefined);
  assert.equal(redistillInstructions(BIG, null, 'focus on the failing test', false), 'focus on the failing test');
  assert.equal(redistillInstructions(undefined, null, undefined, false), undefined);
});

test('the first compaction has nothing to re-distil', () => {
  for (const previous of [undefined, '']) {
    assert.equal(redistillInstructions(previous, THRESHOLDS, undefined, false), undefined, String(previous));
    assert.equal(redistillInstructions(previous, THRESHOLDS, 'user text', false), 'user text', String(previous));
  }
});

test('a previous summary below aboveTokens injects nothing', () => {
  // 3,999 tokens against a threshold of 4,000.
  assert.equal(redistillInstructions(SMALL, THRESHOLDS, undefined, false), undefined);
  assert.equal(redistillInstructions(SMALL, THRESHOLDS, 'user text', false), 'user text');
});

test('a previous summary at aboveTokens asks for a fixed point, naming both numbers', () => {
  const instruction = redistillInstructions(BIG, THRESHOLDS, undefined, false);
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
  const instruction = redistillInstructions(BIG, THRESHOLDS, user, false);
  assert.ok(instruction.startsWith(user), 'the user text is not modified and stays first');
  assert.ok(instruction.includes(user), 'and is present verbatim');
  assert.match(instruction, /The previous summary is 4000 tokens/);
  assert.notEqual(instruction, user);
});

test('the host token estimate this package depends on is probed, not assumed', () => {
  const checked = checkTokenSeam();
  assert.equal(checked.ok, true, checked.detail);
  assert.match(checked.detail, /estimateTokens/);

  // The failure this exists for: a host that no longer sizes a `compactionSummary` message returns 0
  // or NaN, `previousTokens < aboveTokens` is then false for every summary, and redistilling turns
  // itself on for every compaction while naming a wrong number — silently the opposite of inert.
  const broken = [
    [() => 0, 'zero'],
    [() => Number.NaN, 'NaN'],
    [() => Number.POSITIVE_INFINITY, 'Infinity'],
    [() => 1, 'the same size whatever the length'],
    [() => 100, 'monotone the wrong way'],
    [() => { throw new Error('not a message'); }, 'throwing'],
  ];
  for (const [estimate, why] of broken) {
    const result = checkTokenSeam(estimate);
    assert.equal(result.ok, false, why);
    assert.ok(result.detail.length > 0, `${why}: a mismatch has to say what it saw`);
  }
  // A host that reports a size the package can reason about is accepted, whatever its constant is.
  assert.equal(checkTokenSeam((message) => Math.ceil(message.summary.length / 5)).ok, true);
});

test('a host whose token estimate did not check out gets no redistilling at all', () => {
  const thresholds = { aboveTokens: 4_000, targetTokens: 6_000 };
  assert.deepEqual(redistillFor(thresholds, { ok: true, detail: 'fine' }), thresholds);
  assert.equal(redistillFor(thresholds, { ok: false, detail: 'zero' }), null);
  assert.equal(redistillFor(null, { ok: false, detail: 'zero' }), null);
  // And the gate is what makes it inert, not the summary: this one is four times the threshold.
  const refused = redistillFor(thresholds, { ok: false, detail: 'zero' });
  assert.equal(redistillInstructions(BIG, refused, undefined, false), undefined);
  assert.equal(redistillInstructions(BIG, refused, 'user text', false), 'user text', "the caller's own text is untouched");
});

test('/compaction reports redistilling, and says why when the host cannot be trusted for it', () => {
  const thresholds = { aboveTokens: 4_000, targetTokens: 6_000 };
  const ok = { ok: true, detail: 'estimateTokens() sized a compactionSummary message' };
  const bad = { ok: false, detail: 'estimateTokens() returned 0 for a 56-character summary' };
  assert.equal(redistillStatus(null, ok), 'Redistilling: off');
  assert.equal(
    redistillStatus(thresholds, ok),
    'Redistilling: on — asks for a fixed point once the previous summary reaches 4000 tokens, '
    + 'naming 6000 as the target (a request, not a ceiling)',
  );
  // Configured but unusable: the line has to say which of the two it is.
  const refused = redistillStatus(thresholds, bad);
  assert.match(refused, /^Redistilling: off/);
  assert.match(refused, /token estimate did not check out/);
  assert.ok(refused.includes(bad.detail), 'and quotes what the probe saw');
  assert.equal(redistillStatus(null, bad), refused, 'the same line whether or not it was configured');
});

test('a split turn is left alone, and the caller\'s own text still reaches both requests', () => {
  // The host applies one custom-instruction value to both of a split turn's summarization requests,
  // and the second one's document is only the current turn's prefix: no previous summary, and its
  // output is concatenated onto the merged summary rather than being one. The instruction's premise
  // would be false there, and its pruning clause would aim at the newest range — the one loss this
  // package otherwise refuses to risk. So a split turn asks for nothing.
  assert.equal(redistillInstructions(BIG, THRESHOLDS, undefined, true), undefined);
  assert.equal(redistillInstructions(BIG, THRESHOLDS, 'user text', true), 'user text');
  // The same summary, the same thresholds, not a split turn: it asks.
  assert.match(redistillInstructions(BIG, THRESHOLDS, undefined, false), /The previous summary is 4000 tokens/);
});

test('the instruction is the same for every compaction at the same size', () => {
  // A fixed template in the source, not a prompt knob: the only variable parts are the two numbers.
  const first = redistillInstructions(BIG, THRESHOLDS, undefined, false);
  const second = redistillInstructions(BIG, { aboveTokens: 1, targetTokens: 6_000 }, undefined, false);
  assert.equal(first, second, 'aboveTokens decides whether to ask, not what to say');
  const other = redistillInstructions(BIG, { aboveTokens: 1, targetTokens: 4_000 }, undefined, false);
  assert.equal(other, first.replace('under 6000', 'under 4000'), 'only the named target differs');
});
