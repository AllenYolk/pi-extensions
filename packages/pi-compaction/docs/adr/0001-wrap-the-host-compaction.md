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

The consequence is that two host seams are implicit contracts: the argument list of `compact()` and
the point at which the stream function is called. Neither is a documented extension API. The
extension therefore verifies both at activation and hands compaction back to the host when they do
not match, following the presentation adapter's precedent of accepting tested signatures rather than
version text. The extension does not own the summary prompt and will not diverge from it.
