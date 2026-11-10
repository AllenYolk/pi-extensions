---
"@allenyolk/pi-compaction": minor
---

Fix what four independent algorithm audits found in the first release.

**An attempt now accepts what its own request bounds.** A single-pool request asks for the text budget
plus the reasoning budget as one envelope, while the acceptance test accepted only the text budget.
That left a dead band — 8,000 tokens on `balanced`, 24,000 on `deep` — in which a summary the provider
was allowed to write was refused anyway, costing a second full summary request every time a model
landed in it. `deep` was strictly worse than `balanced` for it: the same acceptance bound with three
times the room to overshoot into.

**A split turn is no longer read through its last response only.** The host makes two summarization
requests through the same stream function and concatenates both into one summary, so a clean second
response said nothing about a partial first one — and a partial history response could be persisted.
Every response an attempt produces is now checked. A split turn whose history range is empty is
declined before any request, because the host would carry the previous summary forward verbatim and no
budget this package sets could bound the result.

**The tighter rung asks for a thinking level the model actually has.** The host omits its reasoning
option only for a level of exactly `off`, so on a model whose `thinkingLevelMap` marks `off`
unsupported the retry left the adapter to its own default effort, which can be higher than the first
attempt's. The announcement now names the level the retry used.

**The host's file-list block no longer counts against the model's budget**, so a summary that used
exactly its budget is accepted rather than refused for text the model never wrote.

**The host's retry policy is passed through.** It was `undefined`, and the host's own
`retryAssistantCall()` wrapper never retries without one — so a transient stream drop on a
minutes-long summary request failed the whole compaction on the first attempt.

**A model that switches its own output ceiling off is detected.** `openai-responses` writes
`max_output_tokens` only while `compat.supportsMaxOutputTokens` is not false; the flag defaults to on,
but a model that switches it off dropped the ceiling silently while the status view still reported one.
Such a model is now treated as sending no ceiling, and the announcement names the flag.

**A cut point that leaves nothing to summarise is announced.** It handed compaction back silently,
contradicting the package's own statement that degradation is never silent.

The README's per-cycle figures are also corrected. The `36,938 / 22,938 / 6,938` previously credited to
"the bounded summary and the prune path" splits into a summary term, a kept-window term, and nothing
at all from pruning — base context is measured before a prune can run. Read like for like at the same
kept window, the per-cycle gain is 1.14× / 1.04× / 0.93× rather than 1.25× / 1.16× / 1.05×.
