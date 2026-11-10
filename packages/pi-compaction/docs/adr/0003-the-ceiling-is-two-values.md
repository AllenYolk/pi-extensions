# The output ceiling is two absolute values, not one

A preset carries a text budget and a reasoning budget as two independent absolute token values, and
the ceiling a preset permits is their sum.

A single value covering reasoning and summary text together was the original requirement, and it
holds on some provider APIs and not others. Where the host's output option is a single pool, one
value bounds both. Where it is the answer budget, the host adds the thinking budget on top of it, so
one value bounds only the text and the total is unbounded — and the default summarizer for the
balanced preset sits on such an API. On the same APIs the host reserves a fixed, small amount of
answer room, so a single tight value with a high thinking level yields a summary far smaller than
the value suggests, or a truncated one.

Two values bound the request on every provider API the extension supports and give the summary text
a floor that a reasoning phase cannot consume. Neither value is derived from the host's reserved-token
setting: that setting moves the compaction trigger and has never bounded summary output.

The consequence is that the preset tuple is public configuration. Changing its shape later is a
breaking change for anyone who has written a configuration file, so the four preset names and the
four fields they carry are part of the package's contract from the first release.
