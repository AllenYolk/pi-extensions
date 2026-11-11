---
"@allenyolk/pi-compaction": minor
---

Fix what four independent algorithm audits found in the first release, and remove the parts of the
design that assumed the summarizer follows instructions.

## Fixes

**An attempt now accepts what its own request bounds.** A single-pool request asks for the text budget
plus the reasoning budget as one envelope, while the acceptance test accepted only the text budget.
That left a dead band — 8,000 tokens on `balanced`, 24,000 on `deep` — in which a summary the provider
was allowed to write was refused anyway, costing a second full summary request every time a model
landed in it. `deep` was strictly worse than `balanced` for it: the same acceptance bound with three
times the room to overshoot into. The bound is now the pool on both API classes.

**A split turn is no longer read through its last response only.** The host makes two summarization
requests through the same stream function and concatenates both into one summary, so a clean second
response said nothing about a partial first one — and a partial history response could be persisted.
Every response the request produces is now checked. A split turn whose history range is empty is
declined before any request, because the host would carry the previous summary forward verbatim and no
budget here could bound the result.

**The host's file-list block no longer counts against the model's budget**, so a summary that used
exactly its budget is accepted rather than refused for text the model never wrote.

**The host's retry policy is passed through.** It was `undefined`, and the host's own
`retryAssistantCall()` wrapper never retries without one — so a transient stream drop on a
minutes-long summary request failed the whole compaction on the first attempt.

**A model that switches its own output ceiling off is detected.** `openai-responses` writes
`max_output_tokens` only while `compat.supportsMaxOutputTokens` is not false; a model that switches it
off dropped the ceiling silently while the status view still reported one. Such a model is now treated
as sending no ceiling, and the announcement names the flag.

**A cut point that leaves nothing to summarise is announced.** It handed compaction back silently,
contradicting the package's own statement that degradation is never silent.

**A zero reasoning budget no longer claims the summarizer will not reason.** On a model whose
`thinkingLevelMap` marks `off` unsupported — the owner's own conversation model marks both `off` and
`minimal` unsupported — the request is clamped to the lowest level it has and the model reasons anyway,
drawing from the same envelope as the text. The status view printed "the summarizer does not reason"
for that case. There is now an `uncapped` reasoning-budget effect, and on an answer-budget API the
view says the reported ceiling is a lower bound, because the adapter adds a thinking budget of its own
when none is supplied.

## Removals

**The retry ladder is gone, and a length stop is now accepted.** Both rungs depended on the model
following instructions: the single-pool rung appended a written "keep the summary within N tokens"
instruction, and the answer-budget rung halved both budgets, which makes a length stop more likely
rather than less. Both cost a second full request for an outcome the ceiling had already decided.

A compaction now makes one request. A length stop — the provider cutting the response at the ceiling
this package asked for — is accepted and the truncated summary is persisted, because that is what a
ceiling means. This deliberately overrides a host decision, and
[ADR 0004](https://github.com/AllenYolk/pi-extensions/blob/main/packages/pi-compaction/docs/adr/0004-accept-a-length-stop-as-the-budget-working.md)
records why. A model error, a timeout or an unobserved response still hands back to stock Pi.

## Corrections

The README's per-cycle figures are corrected. The `36,938 / 22,938 / 6,938` previously credited to
"the bounded summary and the prune path" splits into a summary term, a kept-window term, and nothing
from pruning — base context is measured before a prune can run. Read like for like at the same kept
window, the per-cycle gain is 1.14× / 1.04× / 0.93× rather than 1.25× / 1.16× / 1.05×, and `deep`
costs capacity on the measured profile rather than saving it.
