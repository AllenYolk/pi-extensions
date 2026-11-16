# Ask for a fixed point: re-distil through the host's own custom-instruction slot

This is a narrow exception to [ADR 0005](0005-bound-by-not-bounding.md), which is otherwise unchanged.
Nothing here bounds a summary, and the completeness guarantee it protects is untouched.

## The problem

The summary is the one thing in a session that only ever grows. The host's update prompt tells the
summarizer to `PRESERVE all existing information from the previous summary` and to `ADD` what is new,
and hands it the previous summary in `<previous-summary>` tags. Each compaction is therefore a
monotone union of the one before it: nothing is subtracted by construction.

Measured on the owner's machine, this package's chain grew by a median of +525 tokens per compaction
against +2,148 and +1,647 for the two stock chains — six times slower than stock Pi, and one step in
the chain **shrank by 767 tokens with no instruction at all**, which is the observation this decision
starts from. It is also a slow leak rather than an urgent one: seventeen compactions at that rate cost
roughly 8,000 tokens of a 240,000-token window.

## What this decides

An inert `redistill` configuration field:

```json
{ "redistill": { "aboveTokens": 4000, "targetTokens": 6000 } }
```

When it is set, a previous summary of at least `aboveTokens` makes the package append one fixed
instruction to `compact()`'s `customInstructions` argument, which the host renders as an
`Additional focus:` line. The instruction asks for a change of merge semantics, from union to fixed
point, by naming what may be dropped rather than by asking for brevity: the host already says "keep
each section concise" and the specification records a model that ignored it on 16 of 16 compactions.

Absent, `null` or half-configured means off, and the fifth argument to `compact()` is then exactly
what it was. The wording is a fixed template in the source with two numbers in it, not a free-text
prompt field: a template is testable, and a prompt knob would be a second prompt to maintain.

**A split turn is left alone.** The host applies one `customInstructions` value to *both* of a split
turn's summarization requests, and the second one's document is only the current turn's prefix: no
previous summary, and its output is concatenated onto the merged summary rather than being one. There
the instruction's premise is false and its pruning clause — drop detail about work that is finished and
no longer referenced — aims at the newest range, the one no earlier summary covers and the one loss
this package otherwise refuses to risk. Giving the two requests different wording would mean
rewriting the built prompt inside our own stream function, which is a fourth kind of "changing what
the summarizer reads" and a seam this package does not take. A caller's own `/compact <text>` is
unaffected and still reaches both requests.

**The size the instruction names is itself a host seam**, the fourth this package depends on:
`estimateTokens()` accepting a `compactionSummary` message. It is probed at activation alongside the
other three, because a host that stopped recognising the shape would report 0 or `NaN`, every summary
would then read as below `aboveTokens`, and redistilling would turn itself on for every compaction
while naming a wrong number. A failed probe turns redistilling off and says so in `/compaction`;
compaction itself is untouched.

## Why this is not the ceiling ADR 0005 removed

Every mechanism ADR 0005 rejected damaged the **current response**:

| Mechanism | What it damaged |
| --- | --- |
| An output ceiling | The response stops mid-sentence, and the host's prompt puts `## Next Steps` and `## Critical Context` last, so a cut removes them first |
| A retry ladder | Asked for compliance and then halved the budget, which assumes the thing this package must not assume and makes a length stop more likely |
| Truncation | Produced a summary that reads as complete when it is not |
| An index-shaped fallback | A summary the model did not write |

This one changes the **request**. A model that ignores the instruction produces exactly today's
summary. A model that half-follows it produces a complete summary organised differently. No
`max_output_tokens` is sent, nothing is truncated, no response is rewritten, and **the stop-reason
check is untouched**: every response the attempt produced still has to have stopped with `stop`, and a
partial response to a redistilled request is still never persisted. That check is the whole of this
package's quality guarantee, and it is why the stream function survives.

The three other levers an extension has were considered and rejected: replacing `previousSummary` in
the preparation would mean a second model request *before* the main one, whose output this package
would have authored and fed to the summarizer as if it were history; post-processing the summary is
ADR 0005 in full; and not calling `compact()` is [ADR 0001](0001-wrap-the-host-compaction.md).

## What it accepts

The honest risk is the opposite of the one ADR 0005 guards against: a weak model told it may drop
superseded entries may over-drop. That is why the bar for ever enabling this by default is stated in
probes, sections and fabricated paths rather than in tokens, and why the field ships inert.

Two more limits are deliberate. It asks; it does not enforce, so a model that ignores it costs nothing
and gains nothing. And it is one request, unchanged in count — the value of a compaction that finishes
in 36 s is not spent on a second call.

The instruction is also **not durable across a handback**. The host applies only the caller's own
`/compact <text>` on its own path, so a degraded compaction stops asking for it; the announcement says
so rather than claiming that three things are the whole of what this package controls.

And `redistill` is **file-only**. The command surface cannot set it, so a save must not erase a value
the parse did not adopt: a half-configured pair is off, and a `/compaction …` change is refused rather
than silently dropping it. For the same reason an off value is written as an absent key, because 0.2.x
rejects a file carrying a field it does not know — and rejects the whole file, not the key.

## Status

**Unvalidated.** No arm of the experiment has been run. [The method](../validation.md#the-redistilling-experiment)
is recorded with a place for the numbers; until they exist, this field is a documented, tested,
inert request that nobody has shown to work. A prompt that models ignore is a fact about the models,
and it belongs in the validation document whatever it turns out to be.

If no arm clears the bar, the decision that follows is to keep the field inert and record the negative
result — not to reach for a ceiling, which is what ADR 0005 exists to prevent.
