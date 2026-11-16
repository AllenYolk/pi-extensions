# @allenyolk/pi-compaction

## Unreleased

### Minor Changes

Degrade to a configured fallback summarizer before handing back to the conversation model.

Every failure used to hand compaction straight back to stock Pi, which summarises with the
**conversation model at the session's thinking level**. The owner recorded that as 211 s and $1.42
against 36 s and $0.011 for the configured summarizer, on the same conversation model and compaction
ordinal ([issue #28](https://github.com/AllenYolk/pi-extensions/issues/28)) — the thing this package
exists to avoid. Those figures are the owner's own measurement and are not reproduced by this
repository. One optional field puts a step in between.

- **`fallbackModel`** — `provider/model`, or `null` — the default — for no fallback, which is the
  behaviour of `0.2.1` exactly. `"conversation"` is accepted as a spelling of `null`; so is `none` from
  the command. There is deliberately no way to name the conversation model as a fallback, because the
  host handback already is that.

Resolution is `summarizerModel` → `fallbackModel` → hand back to the host. One fallback, never a list.
The fallback attempt gets the **same thinking level** and the **same kept window** as the primary: it
is a different model, not a different compaction.

Four failures fall back — this host does not offer the summarizer model, the host has no configured
credentials for it, the summarizer reported an error, and a partial or unobserved response. Four do
not: a cancellation still answers `{cancel: true}` and attempts nothing, a host seam mismatch, a cut
point with nothing to summarise, and a rejected configuration.

**The partial-summary guarantee applies to the fallback too.** A partial or unobserved response from
the fallback is refused exactly as one from the primary is, and then compaction hands back. Nothing
this package cannot vouch for is persisted, whichever model wrote it.

**The record does not lie.** A fallback that produced the summary is recorded as a new
`pi-compaction-fallback` custom session entry rather than a `pi-compaction-degradation` one, and is
announced as a recovery rather than a handback. Both records now carry every attempt in order, with
the reason each failed and the model that actually ran; `/compaction` reports them, and with no
fallback configured its output and the announcement are unchanged.

`/compaction fallback provider/model | conversation | none` sets it, and `/compaction` reports the
fallback along with whether this host offers it with configured credentials.

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
