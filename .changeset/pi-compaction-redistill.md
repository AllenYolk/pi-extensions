---
"@allenyolk/pi-compaction": minor
---

Add an inert `redistill` field that asks the summarizer to re-distil the previous summary.

The host's update prompt makes every compaction a union of the previous summary, so the summary is
the one thing in a session that only ever grows. The one lever an extension has that does not damage
the current response is `compact()`'s `customInstructions` argument, which the host appends to its
own prompt as an `Additional focus:` line — on the main summary and on a split turn's turn prefix
alike. This package already passed `event.customInstructions` straight through; it now appends one
fixed instruction to it when `redistill` is configured:

```json
{ "redistill": { "aboveTokens": 4000, "targetTokens": 6000 } }
```

`aboveTokens` is the size a previous summary must reach before anything is asked, and `targetTokens`
is the number the instruction names. The wording is a fixed template in the source with those two
numbers as its only variable parts — no free-text prompt field — and it asks for a change of merge
semantics, from union to fixed point, by naming what may be dropped rather than by asking for brevity.

Absent, `null` or half-configured means off, and the fifth argument to `compact()` is then exactly
what it was; an unknown or malformed `redistill` rejects the configuration whole, like every other
field. A session's first compaction has nothing to re-distil and injects nothing. A `/compact <text>`
of the user's own is appended to and never replaced. `/compaction` reports whether redistilling is on
and at what thresholds.

It asks; it enforces nothing. No output ceiling is sent, nothing is truncated or rewritten, and a
model that ignores the instruction produces exactly today's summary — so the package's guarantee is
untouched: every response the attempt produced still has to have stopped with `stop`, and a partial
response to a redistilled request is still never persisted. ADR 0006 records why this is not the
ceiling ADR 0005 removed, and ADR 0005 cross-links it.

**Unvalidated.** No arm of the three-arm experiment has been run, so nothing here claims the
instruction works. `docs/validation.md` records the method, the bar and a marked place for the
numbers, including the negative result if that is what the measurement says; `eval/README.md`
documents the `+<aboveTokens>:<targetTokens>` arm suffix that runs it on the harness from #29. The
field ships inert.

The evaluation harness itself gains that arm suffix and records the instruction each arm sent. It is
development tooling and stays outside the tarball.
