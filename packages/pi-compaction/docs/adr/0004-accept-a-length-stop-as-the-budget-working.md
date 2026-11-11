# Accept a length stop as the budget doing its job

A compaction summary is bounded by the output ceiling this package injects, and the provider enforces
that ceiling by cutting the response. The host treats the resulting `length` stop as a summarization
failure: `getSummarizationFailure()` throws, `compact()` never returns, and the package is left with
nothing to persist.

For a caller that sets no ceiling — which is every caller of the host's own compaction — that is
right. A length stop there is an accident: the model ran into the model's own output limit and the
summary is incomplete for a reason nobody chose.

For this package the same stop means the opposite. The ceiling was chosen, the provider enforced it,
and the response is exactly as long as it was asked to be. Treating that as a failure turns the one
bounded outcome into a handback, and a handback is the unbounded summary this package exists to
remove. On a session whose previous summary already exceeds the budget, that path is not a rare
accident — the host's own prompt asks the model to preserve everything, so it is the expected result.

So the stream function this package owns reports a `length` stop to the host as a normal stop, and
records the real stop reason for its own acceptance test. The host returns a compaction result, the
package persists the truncated summary, and the budget holds.

The summary is then incomplete. That is the honest meaning of a ceiling: the caller asked for N tokens
and got N tokens. The alternatives were considered and rejected:

- **Truncate an over-budget summary instead.** The provider already cuts at the ceiling, so this only
  applies where the adapter raises the ceiling above the text budget. Cutting mid-document produces a
  summary that reads as complete when it is not — a `### Done` list with three entries implies three
  items were done, not that eighteen were dropped. An index that declares what it is was preferred to
  a narrative that lies about its own extent, and no index is built (see below).
- **Hand back to stock Pi.** Unbounded, minutes long, and it feeds a larger previous summary into the
  next attempt, so the failure compounds.
- **Retry with a tighter configuration.** This was the previous design, and it was removed rather than
  refined. The single-pool retry leaned on a written "stay within N tokens" instruction, which is
  exactly the compliance this package must not assume. The answer-budget retry halved both budgets,
  which makes a length stop *more* likely, not less. Both cost a second full request for an outcome
  the ceiling has already decided.

What remains is one request per compaction. A model error, a timeout or an unobserved response still
hands back to stock Pi, which is unchanged and deliberate: this package does not fabricate a summary
it did not receive. Only the stop reason that means "the budget worked" is accepted.

## What this does not do

It does not make a truncated summary as good as a complete one. A session that needs more than the
budget allows will lose detail, and the package cannot tell the caller how much — the host's file-list
block is appended after the model stops, and the model was never asked to report what it left out.

Choosing a budget remains the caller's judgement, and `/compaction` reports what each preset permits.
