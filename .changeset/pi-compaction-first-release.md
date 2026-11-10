---
"@allenyolk/pi-compaction": minor
---

First release: bounded context compaction for Pi.

The summary request carries a hard ceiling expressed as two absolute token values — a text budget and
a reasoning budget — neither derived from the host's reserved-token setting. The summarizer gets its
own model and its own thinking level, independent of the conversation model and the session's.

- Four presets (`fast`, `balanced`, `deep`, `off`) switch the whole tuple from `/compaction` while a
  session runs; `off` returns compaction to stock Pi. Every knob is settable from the same command
  and written back to the configuration file.
- The kept window is this package's own token target rather than the host's recent-token setting, and
  the read-files and modified-files blocks are capped without inheriting the previous compaction's
  lists.
- Pruning replaces an old tool result with a bounded placeholder as a persisted `context_edit`,
  keeping the originating tool call, and only when invalidating the provider prompt cache is already
  free or compaction is imminent. Results the agent cannot recover by re-running their tool are never
  pruned.
- A length stop or an over-budget summary is retried once with the tighter configuration the model's
  API class calls for. Anything that still fails degrades to stock Pi with an announced reason, a
  widget pinned above the editor and a durable session record. A truncated or partial summary is
  never persisted, at any step.
- The status view reports what the provider will actually receive, including the APIs where the
  reasoning budget is advisory and the one that sends no output ceiling at all.

The package ships inert: installing it changes nothing until it is explicitly enabled. It adds no
tools, never patches the host, and has no runtime dependencies and no peer dependency beyond Pi
itself.
