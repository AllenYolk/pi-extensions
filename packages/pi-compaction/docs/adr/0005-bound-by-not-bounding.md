# Bound the summary by not bounding it: pick the model, pick the thinking level

This package's job is to make compaction **faster** by letting the caller choose which model produces
the summary and how hard that model thinks. It does not bound the summary, does not replace any tool
result, and does not judge the summary's contents.

## What "quality" means here

The requirement is that the summary is **whole**: not cut off, not damaged, not a partial response
written as if it were complete. A summary produced by a weaker model with less thinking is acceptable.
A truncated one is not.

That definition rules out every mechanism that could shorten a summary, and it rules them out for the
same reason: each one produces a summary that ends before the model finished, and the host's prompt
puts the two sections a continuing model most needs — `## Next Steps` and `## Critical Context` — at
the very end, so a cut removes them first.

So the output ceiling is gone. The host sends no `max_tokens` on its summarization request, and this
package does not add one; the summary is as long as the model and the host's own prompt make it.

## What replaces the ceiling

Nothing, and that is the point. A ceiling had to be defended, and every defence damaged the summary:

- **A retry ladder** asked the model to comply — one rung appended a written "stay within N tokens"
  instruction, the other halved the budgets. Both assume the summarizer follows instructions, which is
  precisely what this package must not assume, and the second makes a length stop *more* likely.
- **Accepting a length stop** kept the bound but persisted a truncated summary, which is the failure
  this ADR exists to avoid. [ADR 0004](0004-accept-a-length-stop-as-the-budget-working.md) recorded
  that decision and is superseded by this one; it was correct about why a length stop is the budget
  working, and wrong about that being acceptable.
- **Truncating an over-budget summary** produced one that reads as complete when it is not: a `### Done`
  list with three entries implies three items were done, not that eighteen were dropped.
- **An index-shaped fallback** when the model failed entirely was considered and rejected. It is a
  summary the model did not write, which is a different kind of incompleteness.

The one thing that is still refused is a response that stopped for a reason the host does not reject
but that carries partial text — `aborted` being the case the specification names. The host returns
such a summary unchanged; this package will not persist one. That check is the whole of the quality
guarantee, and it is why the stream function survives even though it no longer injects anything: it is
how the package reads the stop reason.

## Superseded

- [ADR 0002](0002-prune-durably-not-per-request.md) — pruning replaced old tool results with bounded
  placeholders. It was the one mechanism that never touched a model, and it was removed because it
  changes what the summarizer reads, which is a summary this package would be responsible for.
- [ADR 0003](0003-the-ceiling-is-two-values.md) — the two-value ceiling. Superseded in full: there is
  no ceiling, so there is nothing to split into two values.
- [ADR 0004](0004-accept-a-length-stop-as-the-budget-working.md) — superseded as described above.

[ADR 0001](0001-wrap-the-host-compaction.md) stands: the host's `compact()` still owns the summary
prompt, the conversation serializer, split-turn handling and the file-list format, and the package
still wraps rather than reimplements. Its three implicit seams are still probed, including the third —
the host awaits `result()` on what the stream function returns — because the stop-reason read depends
on it.

## What the caller loses

The summary is bounded by the summarizer model's own output limit, which is what stock Pi already
does. On the profile this package was built against that meant 26,019 tokens by the sixteenth
compaction and a base context of 93,152 — unchanged by this package. Growth per cycle, and therefore
how much work a session absorbs between compactions, is not something this package improves.

Speed is what it improves: the same summary request, on a model and a thinking level chosen for the
job rather than inherited from the conversation.
