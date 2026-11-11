# The output ceiling is two absolute values, not one

> **Superseded by [ADR 0005](0005-bound-by-not-bounding.md).** The output ceiling, the prune
> path and the acceptance of a length stop were all removed; see that ADR for why.

A preset carries a text budget and a reasoning budget as two independent absolute token values, and
the ceiling a preset permits is their sum.

A single value covering reasoning and summary text together was the original requirement, and it
holds on some provider APIs and not others. Where the host's output option is a single pool, one
value bounds both. Where it is the answer budget, the host adds the thinking budget on top of it, so
one value bounds only the text and the total is unbounded — and the default summarizer for the
balanced preset sits on such an API. On the same APIs the host reserves a fixed, small amount of
answer room, so a single tight value with a high thinking level yields a summary far smaller than
the value suggests, or a truncated one.

Two values bound the request on every provider API the extension supports. Neither value is derived
from the host's reserved-token setting: that setting moves the compaction trigger and has never
bounded summary output.

What two values do **not** give is a ceiling on the text. On every class that emits an output
ceiling, the host reaches the provider with `textBudget + reasoningBudget`, and reasoning is drawn
from inside that envelope, so the text can occupy the whole pool. The reasoning budget is only
enforced where the adapter reads it: on the answer-budget APIs it caps thinking, so at least
`textBudget` of room remains available for text; on the single-pool Responses APIs the adapter never
reads it and sends only a reasoning effort level, which is not a token cap, so it merely enlarges
the pool and the text has no independent bound. One Responses-family API emits no output-ceiling
field at all. An earlier draft of this decision claimed the two values gave the text a floor a
reasoning phase could not consume; that is false on the single-pool and no-ceiling APIs, and the
package treats an unenforceable ceiling as a reason to hand compaction back rather than to proceed.

The consequence is that the preset tuple is public configuration. Changing its shape later is a
breaking change for anyone who has written a configuration file, so the four preset names and the
four fields they carry are part of the package's contract from the first release.
