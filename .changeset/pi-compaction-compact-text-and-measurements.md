---
"@allenyolk/pi-compaction": patch
---

Document the `/compact <text>` passthrough, and record what the owner's machine measured.

`/compact <text>` is the host's command, and this package passes `event.customInstructions` into
`compact()` as its fifth argument, so the text reaches the summarizer this package chose. The README
did not say so. It now explains that the host appends the text to its own summarization instructions
as an `Additional focus:` line, that it applies to manual compactions only because the host sets no
custom instructions on the threshold and overflow paths, that it steers rather than replaces the
host's section format and reaches both requests of a split turn, and that it survives a handback
because the host applies the same line on its own path.

`docs/validation.md` gains one *Measured on the owner's machine* section. Every figure in it was
re-derived from `~/.pi/agent/sessions` with the host's own `estimateTokens`,
`sessionEntryToContextMessages` and `buildSessionProjection`, bounded at a stated timestamp because
the session it reads is still running: 22 `compaction` entries up to that instant across 70 session
files, 16 distinct after de-duplicating the six that a resumed session copied into a second file, and
10 of them through this package's hook with zero degradation entries and zero handbacks. It
carries the measured table, the ranges behind it, the file-list sizes (20–37 against the per-list cap
of 40), the kept-window range (9,639–16,969 against the 16,000 cap), the summary growth (+538 tokens
per compaction, with one step shrinking by 767), and the structural result that 10/10 summaries
carried all nine sections and named zero paths the summarised range does not support.

It also states what the numbers are not — one machine, one workload, a small n, wall time inferred
from entry timestamps rather than recorded, and cost taken from the host's own accounting against a
proxy's pricing rather than an invoice — points at #29 for the reproducible version, and records
which figures from #32 could not be re-derived because the sessions that carried them are no longer
in the store. The *Not established* entries for latency and summary quality now say what is known and
what is still not: nothing compares two summarizers on the same input, so how much a cheaper
summarizer drops remains unmeasured. The three `shortcut:` entries in *Known limits* gain their
measured evidence, and the two that were re-checked against the host source on 1.5.1 and 1.5.2 still
describe it accurately.
