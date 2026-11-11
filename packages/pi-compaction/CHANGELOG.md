# @allenyolk/pi-compaction

## 0.2.0

### Minor Changes

- 86afaad: Reduce the package to what it should have been: choose the summarizer model, choose its thinking
  level, and never persist a summary that is not whole.
  
  ## Removed
  
  **The output ceiling.** The two absolute budgets, the `maxTokens` injection, the acceptance test and
  the per-API classification that mapped budgets onto adapters are all gone. This package now sends no
  `max_output_tokens` on the summarization request — the same as stock Pi — so the summary is as long as
  the host's prompt and the model make it.
  
  **The prune path.** `turn_end` no longer writes `context_edit` entries and the `prune`,
  `pruneWindowTokens` and `neverPrune` settings are gone, along with `src/prune.ts`.
  
  **The retry ladder.** Two rungs, both of which assumed the summarizer follows instructions: one
  appended a written "stay within N tokens" instruction, and the other halved both budgets — which
  makes a length stop more likely, not less. Both cost a second full request for an outcome the ceiling
  had already decided.
  
  **The presets.** `fast` / `balanced` / `deep` encoded a combination of two budgets, and
  `textBudget` / `reasoningBudget` no longer exist. Configuration is four fields: `enabled`,
  `summarizerModel`, `thinking`, `keptWindowTokens`.
  
  **Why:** every mechanism that could shorten a summary produces one that ends before the model
  finished, and the host's prompt puts `## Next Steps` and `## Critical Context` — the two sections a
  continuing model most needs — at the very end, so a cut removes them first. A shorter summary is not
  worth a wrong one. [ADR 0005](https://github.com/AllenYolk/pi-extensions/blob/main/packages/pi-compaction/docs/adr/0005-bound-by-not-bounding.md)
  records the decision and marks ADR 0002, 0003 and 0004 superseded.
  
  ## Changed
  
  **A length stop is now refused.** `0.1.0` sent an output ceiling and treated a length stop as that
  ceiling working as intended. With no ceiling sent, a length stop means the summarizer hit the
  model's own output limit — a genuinely incomplete summary — so it degrades like any other failure.
  
  **A handback costs the model and the thinking level, and nothing else.** The announcement used to
  describe an unbounded summary; it now says what actually changes, which is that stock Pi compacts with
  the conversation model and the session's own thinking level.
  
  **`/compaction` is much shorter.** It reports the summarizer, the thinking level that will actually
  run, the kept-window target, and states plainly that the summary length is not bounded by this
  package.
  
  ## Breaking
  
  Existing configuration files are rejected. `preset`, `textBudget`, `reasoningBudget`, `prune`,
  `pruneWindowTokens` and `neverPrune` are unknown fields now, and `loadConfig` rejects a file whole
  rather than half-applying it — so a stale file leaves compaction on stock Pi with a diagnostic naming
  the field. The replacement is:
  
  ```json
  {
    "enabled": true,
    "summarizerModel": "provider/model",
    "thinking": "off",
    "keptWindowTokens": 16000
  }
  ```
  
  `summarizerModel: null` — the default — is the conversation model, so installing the package never
  silently lowers summary quality. Choosing a cheaper summarizer is explicit.
  
  ## Unchanged, and what was added to it
  
  `0.1.0` already refused to persist a summary whose response it could not vouch for, and already
  probed three host seams. What `0.2.0` adds is that **every** response a request produced is now
  checked, not only the last one: a split turn makes two summarization requests through the same
  stream function and the host concatenates both into one summary, so a clean second response said
  nothing about a partial first one.
  
  That refusal is now the package's entire quality guarantee, and it is why the stream function
  survives even though it no longer injects anything: it is how the stop reason is read.

## 0.1.0

### Minor Changes

- 3238649: First release: bounded context compaction for Pi.
  
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
