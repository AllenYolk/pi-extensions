# @allenyolk/pi-compaction

## 0.3.0

### Minor Changes

- 5cd0b2e: Add an inert `redistill` field that asks the summarizer to re-distil the previous summary.
  
  The host's update prompt makes every compaction a union of the previous summary, so the summary is
  the one thing in a session that only ever grows. The one lever an extension has that does not damage
  the current response is `compact()`'s `customInstructions` argument, which the host appends to its
  own prompt as an `Additional focus:` line — on the main summary and on a split turn's turn prefix
  alike. This package already passed `event.customInstructions` straight through; it now appends one
  fixed instruction to it when `redistill` is configured:
  
  ```json
  { "redistill": { "aboveTokens": 4000, "targetTokens": 6000 } }
  ```
  
  `aboveTokens` is the size a previous summary must reach before anything is asked, and `targetTokens`
  is the number the instruction names. The wording is a fixed template in the source with those two
  numbers as its only variable parts — no free-text prompt field — and it asks for a change of merge
  semantics, from union to fixed point, by naming what may be dropped rather than by asking for brevity.
  
  Absent, `null` or half-configured means off, and the fifth argument to `compact()` is then exactly
  what it was; an unknown or malformed `redistill` rejects the configuration whole, like every other
  field, and so does a malformed field inside a half-configured pair — the field that is present is
  checked even though the pair is off. A session's first compaction has nothing to re-distil and injects
  nothing. A `/compact <text>` of the user's own is appended to and never replaced.
  
  **A split turn is left alone.** The host applies one custom-instruction value to both of a split turn's
  summarization requests, and the second one's document is only the current turn's prefix: no previous
  summary, and its output is concatenated onto the merged summary rather than being one. The
  instruction's premise would be false there and its pruning clause would aim at the newest range, so
  nothing of this package's is asked for; the user's own text still reaches both requests.
  
  `/compaction` reports whether redistilling is on and at what thresholds, and says so when the host's
  token estimate failed the new activation-time probe that gates it — a fourth host seam, and one whose
  mismatch turns redistilling off rather than handing compaction back.
  
  `redistill` is file-only, so a save defers to the file: a complete valid pair on disk is kept, so a
  threshold edited mid-session is not reverted by an unrelated `/compaction` change, while an incomplete
  or malformed pair is refused with the advice that can help, and a file this session could not load at
  all is refused rather than replaced with defaults. An off value is written as an absent key, because
  0.2.x rejects a file carrying a field it does not know — and it rejects the whole file.
  
  A handback's announcement says what it gives up by name — the model, the thinking level and the cut
  point — and, when redistilling was configured, that the fixed-point request is gone and the summary is
  a union again, rather than claiming its length is unaffected.
  
  It asks; it enforces nothing. No output ceiling is sent, nothing is truncated or rewritten, and a
  model that ignores the instruction produces exactly today's summary — so the package's guarantee is
  untouched: every response the attempt produced still has to have stopped with `stop`, and a partial
  response to a redistilled request is still never persisted. ADR 0006 records why this is not the
  ceiling ADR 0005 removed, and ADR 0005 cross-links it.
  
  **Unvalidated.** No arm of the three-arm experiment has been run, so nothing here claims the
  instruction works. `docs/validation.md` records the method, the bar and a marked place for the
  numbers, including the negative result if that is what the measurement says; `eval/README.md`
  documents the `+<aboveTokens>:<targetTokens>` arm suffix that runs it on the harness from #29. The
  field ships inert.
  
  The evaluation harness itself gains that arm suffix and records the instruction each arm sent. It is
  development tooling and stays outside the tarball.
- 9f9aa09: Degrade to a configured fallback summarizer before handing back to the conversation model.
  
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

### Patch Changes

- 58150b0: Document the `/compact <text>` passthrough, and record what the owner's machine measured.
  
  `/compact <text>` is the host's command, and this package passes `event.customInstructions` into
  `compact()` as its fifth argument, so the text reaches the summarizer this package chose. The README
  did not say so. It now explains that the host appends the text to its own summarization instructions
  as an `Additional focus:` line, that it applies to manual compactions only because the host sets no
  custom instructions on the threshold and overflow paths, that it steers rather than replaces the
  host's section format and reaches both requests of a split turn, and that it survives a handback
  because the host applies the same line on its own path.
  
  `docs/validation.md` gains one *Measured on the owner's machine* section. Every figure in it was
  re-derived from `~/.pi/agent/sessions` with the host's own `estimateTokens`,
  `sessionEntryToContextMessages` and `buildSessionProjection`, bounded at a stated timestamp because
  the session it reads is still running: 22 `compaction` entries up to that instant across 70 session
  files, 16 distinct after de-duplicating the six that a resumed session copied into a second file, and
  10 of them through this package's hook with zero degradation entries and zero handbacks. It
  carries the measured table, the ranges behind it, the file-list sizes (20–37 against the per-list cap
  of 40), the kept-window range (9,639–16,969 against the 16,000 cap), the summary growth (+538 tokens
  per compaction, with one step shrinking by 767), and the structural result that 10/10 summaries
  carried all nine sections and named zero paths the summarised range does not support.
  
  It also states what the numbers are not — one machine, one workload, a small n, wall time inferred
  from entry timestamps rather than recorded, and cost taken from the host's own accounting against a
  proxy's pricing rather than an invoice — points at #29 for the reproducible version, and records
  which figures from #32 could not be re-derived because the sessions that carried them are no longer
  in the store. The *Not established* entries for latency and summary quality now say what is known and
  what is still not: nothing compares two summarizers on the same input, so how much a cheaper
  summarizer drops remains unmeasured. The three `shortcut:` entries in *Known limits* gain their
  measured evidence, and the two that were re-checked against the host source on 1.5.1 and 1.5.2 still
  describe it accurately.
- 6dad3b5: Export the package's thinking levels as one list, `THINKING_LEVELS` in `src/config.ts`.
  
  The same seven levels were written out three times: in `src/config.ts`, in `src/summarizer.ts` and
  again in the evaluation harness. Two modules that each validate or clamp against their own copy
  drift apart silently — a level added to one is not a level the other accepts. `src/summarizer.ts`
  now clamps through the exported list and the harness imports it, so the configuration, the clamp and
  the harness's refusal of an unknown arm level are the same set by construction.
  
  No behavior changes: the list, its order and every rejection message are what they were. The export
  is additive.

## 0.2.1

### Patch Changes

- 90ce1d6: Document what to do when `thinking: "off"` does not take effect.
  
  A model's `thinkingLevelMap` decides which levels it accepts, and a level mapped to `null` is
  unsupported — so such a model is clamped to its lowest level and reasons anyway, with nothing bounding
  it now that this package sends no output ceiling. The README said only that this can happen.
  
  It now explains how to read the level that actually ran from `/compaction`, that the property is
  per-model rather than per-provider (two models behind one gateway can differ), how to inspect what a
  model declares, and that changing `thinkingLevelMap.off` is a request to the provider whose failure is
  reversible.
  
  The repository README is corrected at the same time. Its package table still described this package as
  bounding the summary with two token budgets and pruning old tool results, and its install section said
  the package was not on npm yet and named a `"preset": "off"` setting. None of the three is true of
  `0.2.0`: the ceiling and the prune path were removed before the first release, and the presets went
  with them.

## 0.2.0

### Minor Changes

First release. Choose the model and thinking level Pi compacts with, and never persist a summary that
is not whole.

## What it does

Pi's compaction summarises with the conversation model at the session's thinking level, and there is
no way to change either — so a long session pays for its summary with the most expensive model it has,
at whatever thinking level interactive work needed. This package lets you choose both.

- `summarizerModel` — `provider/model`, or `null` for the conversation model. Defaults to `null`, so
  installing the package never silently lowers your summary quality; choosing a cheaper summarizer is
  explicit.
- `thinking` — `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, clamped to what the chosen
  model supports. Check `/compaction` for the level that actually ran: a model whose `thinkingLevelMap`
  marks `off` unsupported gets its lowest level instead, and reasons anyway.
- `keptWindowTokens` — the cut point is this package's own token target rather than the host's
  recent-token setting.

Those three fields plus `enabled`, in `~/.pi/agent/extensions/pi-compaction/config.json`,
hot-reloadable through `/reload`, and every knob settable from `/compaction`.

## What it does not do

**It does not bound the summary.** The host sends no `max_output_tokens` on its summarization request
and neither does this package, so the summary is as long as the host's prompt and the model make it —
the same as stock Pi. Every mechanism that could shorten one produces a summary that ends before the
model finished, and the host's prompt puts `## Next Steps` and `## Critical Context`, the two sections
a continuing model most needs, at the very end, so a cut removes them first. A shorter summary is not
worth a wrong one.
[ADR 0005](https://github.com/AllenYolk/pi-extensions/blob/main/packages/pi-compaction/docs/adr/0005-bound-by-not-bounding.md)
records the decision and the alternatives that were rejected.

**It does not prune.** Replacing old tool results with placeholders would change what the summarizer
reads, which makes the summary this package's responsibility rather than the host's.

What it improves is speed: the same summary request, on a model and a thinking level chosen for the
job rather than inherited from the conversation.

## The one guarantee

A partial summary is never persisted.

The host rejects a summarization response that stopped with `error` or `length`, and one that tried to
call a tool. For any **other** stop reason it returns the partially written summary unchanged —
`aborted` being the case the specification names. That matters more than it looks: a summary the model
did not finish is a silent change to the session's history, the next compaction is told to preserve
everything in the previous summary so an incomplete one propagates, and nothing in the transcript says
the checkpoint is short.

This package reads the stop reason from the response, through the stream function it owns, and refuses:

- any response whose stop reason is not a clean stop;
- **every** response the request produced, not only the last one. A split turn makes two summarization
  requests through the same stream function and the host concatenates both into one summary, so a
  clean second response says nothing about a partial first one;
- an attempt whose responses were never observed at all.

Reading the stop reason requires owning the stream function, which is why this package wraps it rather
than handing `compact()` a model and walking away — a wrapper that only swaps the model never sees a
response at all.

A failure hands compaction back to stock Pi with an announcement, a widget pinned above the editor and
a durable session entry. That gives up the model and the thinking level, and changes nothing about the
summary's length.

## If you used a pre-release build

A configuration file carrying `preset`, `textBudget`, `reasoningBudget`, `prune`, `pruneWindowTokens`
or `neverPrune` is rejected whole, with a diagnostic naming the field. Those knobs existed during
development and were removed before this release; the shape above replaces them.
