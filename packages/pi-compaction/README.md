# @allenyolk/pi-compaction

Pi's compaction summarises with the **conversation model** at the **session's thinking level**, and
there is no way to change either. A long session therefore pays for its summary with the most
expensive model it has, at whatever thinking level interactive work needed.

This package lets you choose both.

- The **summarizer** — the request that produces the compaction summary — gets its own model and its
  own thinking level, chosen independently of the conversation model and the session's thinking level.
- The **kept window** — the most recent entries a compaction retains verbatim — is the package's own
  token target rather than the host's recent-token setting, so the cut point is a number you control.
- The summary is **never shortened, never truncated and never replaced**. This package sends no
  output ceiling and does not touch tool results. A summary it cannot vouch for is refused rather
  than persisted.

The package ships **inert**. Installing it changes nothing until you enable it.

## What it does not do

It does **not** bound the summary. The host sends no `max_output_tokens` on its summarization request
and neither does this package, so the summary is as long as the host's prompt and the model make it —
the same as stock Pi. On the profile this package was built against that meant 26,019 tokens by the
sixteenth compaction and a base context of 93,152.

That is deliberate, and [ADR 0005](docs/adr/0005-bound-by-not-bounding.md) records why. Every
mechanism that could shorten a summary produces one that ends before the model finished, and the
host's prompt puts `## Next Steps` and `## Critical Context` — the two sections a continuing model
most needs — at the very end, so a cut removes them first. A shorter summary is not worth a wrong one.

It also does not prune. Replacing old tool results with placeholders would change what the summarizer
reads, which makes the summary this package's responsibility rather than the host's.

**What it improves is speed**: the same summary request, on a model and a thinking level chosen for
the job rather than inherited from the conversation.

## Configuration

One JSON file in the Pi agent directory, at `extensions/pi-compaction/config.json`. There are no
project-level overrides, and `/reload` picks up a change without restarting.

```json
{
  "enabled": true,
  "summarizerModel": "minimax-cn/MiniMax-M3.1-Flash",
  "thinking": "off",
  "keptWindowTokens": 16000
}
```

| Field | Meaning |
| --- | --- |
| `enabled` | Whether the package acts at all. Defaults to `false`. |
| `summarizerModel` | `provider/model`, or `null` — the default — for the conversation model. `"conversation"` is accepted as a spelling of `null`. |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Defaults to `medium`, and is clamped to what the chosen model supports. |
| `keptWindowTokens` | Token target for the kept window. Defaults to `16000`. |

An invalid value is rejected whole: the package reports the file and the field, and compaction stays
stock Pi rather than half-applying a configuration.

### Choosing a summarizer

`summarizerModel` defaults to `null` — the conversation model — so installing the package never
silently lowers your summary quality. Choosing a cheaper or faster summarizer is explicit:

```sh
/compaction model minimax-cn/MiniMax-M3.1-Flash
/compaction thinking off
```

The chosen model must be one this host offers with configured credentials; if it is not, the package
says so and hands compaction back to Pi rather than failing the compaction.

### When `off` does not take effect

`thinking: "off"` is a request, not a guarantee. A model's `thinkingLevelMap` decides which levels it
accepts, and a level mapped to `null` is unsupported — so a model that marks `off` unsupported is
clamped to its lowest level instead and reasons anyway. This package sends no output ceiling, so that
reasoning has nothing bounding it.

`/compaction` reports the level that will actually run, not the one you asked for:

```text
Thinking: low (clamped from off; this model has no off, so its reasoning phase still runs)
```

**This is a per-model property, not a property of the provider.** Two models behind one gateway can
differ: on the gateway this package was developed against, one model declares `"off": "none"` and
genuinely stops while its sibling declares `"off": null` and cannot. Check the model you actually
configured, not the provider.

To see what a model declares, read its `thinkingLevelMap` in `~/.pi/agent/models.json`. A model whose
`off` is `null` cannot be told not to reason; setting it to `"none"` makes the request send
`reasoning.effort: "none"` instead.

Changing it is a request to the **provider**, not to this package. If the upstream model does not
accept that effort, the summarization request fails and compaction hands back to stock Pi — annoying,
but reversible: put `null` back. Verify with one real compaction, then re-read `Thinking:` in
`/compaction`.


## The one thing that is refused

A **partial summary** is never persisted.

The host rejects a summarization response that stopped with `error` or `length`, and one that tried to
call a tool. For any **other** stop reason it returns the partially written summary unchanged —
`aborted` being the case the specification names.

This matters more than it looks. A summary the model did not finish is a silent change to the
session's history: the next compaction is told to preserve everything in the previous summary, so an
incomplete one propagates, and nothing in the transcript says the checkpoint is short. **Reading the
stop reason requires owning the stream function**, which is why this package wraps it rather than
handing `compact()` a model and walking away — a wrapper that only swaps the model never sees a
response at all.

The package reads every response the request produced, not only the last one:

- A split turn makes **two** summarization requests through the same stream function and the host
  concatenates both into one summary, so a clean second response says nothing about a partial first
  one. Both are checked.
- An attempt whose responses were never observed at all is refused — it proves nothing.

A length stop is refused too. Since this package sends no ceiling, a length stop means the summarizer
hit the model's own output limit — a genuinely incomplete summary, not a budget working as intended.

A cancellation stops everything and answers `{cancel: true}`: no fallback compaction begins behind
your back.

## Degradation

Degradation is handing compaction back to stock Pi after the package's own attempt fails. It is never
silent, and it is the same announcement whatever caused it: a host seam mismatch, an unavailable
summarizer model, missing credentials, a model error, a partial response, or a cut point that leaves
no history to summarise.

```text
pi-compaction: degraded — compaction handed back to stock Pi
Summarizer: mafia-o/gpt-6.1-sol (openai-responses)
Why: the summarizer reported an error (Summarization failed: 503 model_unavailable)
Now: stock Pi compacts with the conversation model and the session's own thinking level, not the
  summarizer configured here. The summary length is unaffected — neither path sends an output
  ceiling — but the model and the thinking level are the whole of what this package controls, so a
  handback gives both of them up.
Next: /compaction model provider/model to summarise with a different model, /compaction thinking
  off|minimal|low|medium|high to change how hard it thinks, or /compaction disable to make stock Pi
  the default.
```

### How it reaches you

A notification raised from inside a compaction does not paint: the host clears and rebuilds the
transcript when the compaction ends, and anything raised before that is lost. A single stderr line
scrolls away. So the announcement is delivered three ways, and only one of them is the terminal:

| Surface | Survives the repaint | Survives a restart |
| --- | --- | --- |
| `console.error` and `ctx.ui.notify`, immediately | no — the repaint takes it | no |
| A **widget pinned above the editor**, set once the compaction has settled | **yes** — it is chrome the repaint does not touch, and it cannot scroll away | no |
| A **custom session entry**, `pi-compaction-degradation`, read back by `/compaction` | yes | **yes** |

The pinned widget is cleared by the next compaction that completes, and at session start and
shutdown. The session entry is the durable record: custom entries carry no LLM context, so it never
enters the summary or the model's context.

## `/compaction`

`/compaction` on its own shows the effective configuration, what the summarizer will actually run at,
the kept-window target, whether the package is enabled, and the result of the host-seam check. It does
not shadow the host's `/compact`.

```text
Config: /home/you/.pi/agent/extensions/pi-compaction/config.json
Enabled: yes
Summarizer model: minimax-cn/MiniMax-M3.1-Flash (anthropic-messages)
Thinking: off
Kept window: 16000 tokens
Summary length: not bounded by this package — the host sends no output ceiling and neither do we
Host seam: ok — compact() arity 12; our stream function received {apiKey, cacheRetention, env, headers, sessionId, signal} and its result() was awaited
Last degradation: none in this session
```

Every knob is settable from it, and each change is written back to the configuration file:

```text
/compaction enable | disable
/compaction model provider/model | conversation
/compaction thinking off | minimal | low | medium | high | xhigh | max
/compaction window <tokens>
```

## Host-seam check

Three seams this package depends on are not documented extension APIs: the argument list of the host's
`compact()`, the point at which it calls its stream function, and that it awaits `result()` on
whatever that function returns. All three are verified at activation — the arity, and an actual call
through a stream function the package supplies, which needs no credentials and makes no request. A
mismatch degrades to the host instead of letting the package misbehave, and the status view reports
it. Tested signatures decide compatibility, not version text.

The third is the one the package reads a response's stop reason through, which is how it refuses to
persist a partial summary. Losing it would not break compaction — summaries would still be produced,
just unchecked — so it is probed rather than assumed.

## Install

```sh
pi install npm:@allenyolk/pi-compaction
```

Or take it from the [pi-extensions collection](../../README.md#install), or load it for one run:

```sh
pi -e ./packages/pi-compaction/src/index.ts
```

## Status

Its development host, and the host its checks run against, is
`@earendil-works/pi-coding-agent` 1.5.1 — the version whose seams were inspected. It adds no tools,
so it does not change the host's prompt and tool declarations, and it never patches the host, edits
an installed Pi or changes the host's compaction settings. It has no runtime dependencies and no peer
dependency beyond the host itself.

Tested platforms, known limits, rollback instructions, independent-review status and the list of what
is *not* established live in [validation](docs/validation.md).
