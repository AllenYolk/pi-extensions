---
"@allenyolk/pi-compaction": minor
---

Reduce the package to what it should have been: choose the summarizer model, choose its thinking
level, and never persist a summary that is not whole.

## Removed

**The output ceiling.** The two absolute budgets, the `maxTokens` injection, the acceptance test and
the per-API classification that mapped budgets onto adapters are all gone. This package now sends no
`max_output_tokens` on the summarization request — the same as stock Pi — so the summary is as long as
the host's prompt and the model make it.

**The prune path.** `turn_end` no longer writes `context_edit` entries and the `prune`,
`pruneWindowTokens` and `neverPrune` settings are gone, along with `src/prune.ts`.

**The retry ladder.** Already removed in the previous entry; restated because the reason is now part
of a larger one.

**The presets.** `fast` / `balanced` / `deep` encoded a combination of two budgets, and
`textBudget` / `reasoningBudget` no longer exist. Configuration is four fields: `enabled`,
`summarizerModel`, `thinking`, `keptWindowTokens`.

**Why:** every mechanism that could shorten a summary produces one that ends before the model
finished, and the host's prompt puts `## Next Steps` and `## Critical Context` — the two sections a
continuing model most needs — at the very end, so a cut removes them first. A shorter summary is not
worth a wrong one. [ADR 0005](https://github.com/AllenYolk/pi-extensions/blob/main/packages/pi-compaction/docs/adr/0005-bound-by-not-bounding.md)
records the decision and marks ADR 0002, 0003 and 0004 superseded.

## Changed

**A length stop is now refused.** It was accepted in the previous entry, on the reasoning that the
ceiling we asked for was the budget working. With no ceiling sent, a length stop means the summarizer
hit the model's own output limit — a genuinely incomplete summary — so it degrades like any other
failure.

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

## Unchanged

The three host-seam checks, and the refusal to persist a partial summary: any response whose stop
reason is not a clean stop, every response a split turn produced rather than only the last, and an
attempt whose responses were never observed. That refusal is now the package's entire quality
guarantee, and it is why the stream function survives even though it no longer injects anything.
