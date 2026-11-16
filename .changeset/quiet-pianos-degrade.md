---
"@allenyolk/pi-compaction": minor
---

Degrade to a configured fallback summarizer before handing back to the conversation model.

A new optional `fallbackModel` field (`provider/model`, or `null` — the default — for no fallback,
which is `0.2.1`'s behaviour exactly). Resolution becomes `summarizerModel` → `fallbackModel` → hand
back to the host; one fallback, never a list, never the conversation model.

The fallback attempt runs at the primary's thinking level and over the primary's cut point, and the
partial-summary guarantee applies to it unchanged: a partial or unobserved response from the fallback
is refused exactly as one from the primary is.

Four failures fall back — the summarizer model is not offered by this host, the host has no configured
credentials for it, the summarizer reported an error, and a partial or unobserved response. A
cancellation, a host seam mismatch, a cut point with nothing to summarise and a rejected configuration
do not.

A fallback that produced the summary is recorded as a new `pi-compaction-fallback` custom session entry
and announced as a recovery rather than a handback; both records now carry every attempt in order with
the reason each failed and the model that actually ran, and `/compaction` reports them. With no
fallback configured the announcement and the status view are unchanged.

`/compaction fallback provider/model | conversation | none` sets it, and `/compaction` reports whether
this host offers the fallback with configured credentials.
