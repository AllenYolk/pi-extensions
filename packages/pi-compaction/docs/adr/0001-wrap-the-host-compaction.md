# Wrap the host's compaction instead of writing a summarizer

The extension reuses the host's exported `compact()` and supplies its own preparation, rather than
writing a summarizer. The host function takes the preparation as a parameter, so the extension
chooses the cut point and the file operations it wants summarised; the extension then wraps the
stream function argument to carry the output budgets the host never sets. Swapping the summarizer
model and its thinking level needs no wrapper at all — both are already parameters.

Writing our own summarizer was rejected because it would make the extension the owner of the summary
prompt, the conversation serializer, split-turn handling and the file-list format, for a quality
ceiling the owner has explicitly accepted as "whatever the host produces". Depending on a
third-party compaction package was rejected for the same reason plus availability coupling.

The consequence is that three host seams are implicit contracts: the argument list of `compact()`,
the point at which the stream function is called, and that the host awaits `result()` on whatever
that function returns. None is a documented extension API. The extension therefore verifies all
three at activation and hands compaction back to the host when they do not match, following the
presentation adapter's precedent of accepting tested signatures rather than version text. The
extension does not own the summary prompt and will not diverge from it.

The third seam is named separately because it is the one the package reads a response through. It is
how the extension sees a response's stop reason, and therefore how it refuses to persist a summary
the provider did not finish. Its failure mode is silent and quality-only — compaction still produces
summaries, they are just no longer checked — which is why it is probed rather than assumed.

Giving up the read instead was rejected: the host rejects only a stop reason of `error` or `length`,
and a tool call separately, and returns a partially written summary unchanged for any other stop
reason. Without the read there is nothing left to refuse with, so the requirement that a partial
summary is never persisted would have to be dropped with it.
