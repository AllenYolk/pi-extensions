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
  "fallbackModel": "mafia-g/gemini-3.8-flash",
  "thinking": "off",
  "keptWindowTokens": 16000
}
```

| Field | Meaning |
| --- | --- |
| `enabled` | Whether the package acts at all. Defaults to `false`. |
| `summarizerModel` | `provider/model`, or `null` — the default — for the conversation model. `"conversation"` is accepted as a spelling of `null`. |
| `fallbackModel` | `provider/model`, or `null` — the default — for no fallback at all. `"conversation"` and `"none"` are both accepted as spellings of `null`, in the file and from the command. Must differ from `summarizerModel`: the same model cannot be its own fallback, and a file that pairs them is rejected whole. |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Defaults to `medium`, and is clamped to what the chosen model supports. |
| `keptWindowTokens` | Token target for the kept window. Defaults to `16000`. |
| `redistill` | `null` — the default — or two thresholds that ask the summarizer to re-distil the previous summary. See [Asking for a fixed point](#asking-for-a-fixed-point). |

An invalid value is rejected whole: the package reports the file and the field, and compaction stays
stock Pi rather than half-applying a configuration. That includes `fallbackModel` — a half-applied
fallback is worse than none.

### Choosing a summarizer

`summarizerModel` defaults to `null` — the conversation model — so installing the package never
silently lowers your summary quality. Choosing a cheaper or faster summarizer is explicit:

```sh
/compaction model minimax-cn/MiniMax-M3.1-Flash
/compaction thinking off
```

The chosen model must be one this host offers with configured credentials; if it is not, the package
says so and hands compaction back to Pi rather than failing the compaction — unless a
[fallback](#degrading-to-a-fallback-summarizer) is configured.

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


## Steering one compaction

`/compact <text>` is the host's command, and this package carries the text through. The host appends
it to its own summarization instructions as an `Additional focus:` line, and the request it lands on
is the one this package made — so `/compact focus on the failing test` steers the summarizer you
configured rather than the conversation model.

- It applies to **manual** compactions only. The host sets no custom instructions on the automatic
  paths — the context threshold and overflow recovery — so there is nothing to carry there.
- It steers, it does not replace: the host's section format still applies, and on a split turn both
  summarization requests get the line.
- It survives a handback. After a degradation the host compacts with the conversation model and
  applies the same line to its own request. A [redistilling](#asking-for-a-fixed-point) instruction
  this package appended does not survive one: it is this package's, and the host applies only your
  text. The degradation announcement says so when redistilling was configured.

## Asking for a fixed point

**Off by default, and unvalidated.** The host's update prompt makes every compaction a union of the
previous summary, so the summary is the one thing in a session that only ever grows. `redistill` asks
for a change of merge semantics — from union to fixed point — through the one lever that does not
touch the response:

```json
{ "redistill": { "aboveTokens": 4000, "targetTokens": 6000 } }
```

| Field | Meaning |
| --- | --- |
| `aboveTokens` | Only ask when the previous summary is at least this many tokens. Below it there is nothing to win. |
| `targetTokens` | The number the instruction names as the merged summary's target. |

Absent, `null`, or either field on its own means **off**, and the package then behaves exactly as
`0.2.x` does. An unknown or malformed `redistill` rejects the configuration whole, like every other
field, and so does a malformed field inside a half-configured pair.

When it applies, one fixed instruction is appended to the host's `Additional focus:` line:

```text
The previous summary is 5367 tokens and the merged summary should stay under 6000. Keep every goal,
constraint, decision with its rationale, blocker, open question and next step that is still true.
Drop an entry when a later entry supersedes it, and drop detail about work that is finished and no
longer referenced. Do not append a changelog and do not add a history section.
```

- It **asks**. Nothing here makes a summary shorter: no output ceiling is sent, nothing is truncated
  or rewritten, and a model that ignores the instruction produces exactly the summary it produces
  today. [ADR 0006](docs/adr/0006-ask-for-a-fixed-point.md) records why that is not the ceiling
  [ADR 0005](docs/adr/0005-bound-by-not-bounding.md) removed — it changes the request, not the
  response — and the stop-reason refusal below is untouched.
- It applies **only when there is a previous summary** of at least `aboveTokens` tokens. A session's
  first compaction has nothing to re-distil.
- A `/compact <text>` of your own is **appended to, never replaced**, and reaches both summarization
  requests of a split turn — your text always does, whatever this package is configured to ask for.
- A **split turn is left alone**. The host applies one custom-instruction value to both of a split
  turn's requests, and the second one's document is only the current turn's prefix: no previous
  summary, and its output is concatenated onto the merged summary rather than being one. The
  instruction's premise would be false there and its pruning clause would aim at the newest range — the
  one loss this package otherwise refuses to risk — so nothing of this package's is asked for. Giving
  the two requests different wording would mean rewriting the prompt inside our own stream function,
  which is a seam this package does not take.
- The wording is a **fixed template in the source**, with those two numbers as its only variable
  parts. There is no free-text prompt field: a template is testable, and a prompt knob would be a
  second prompt to maintain.
- Nothing is asked for unless this host's token estimate checks out — see
  [Host-seam check](#host-seam-check).

`/compaction` reports whether it is on and at what thresholds, and says so when the host's token
estimate ruled it out. **No arm of its experiment has been run**, so nothing here claims it works:
[the method and the place for the numbers are in
validation](docs/validation.md#the-redistilling-experiment), including the negative result if that is
what the measurement says.

### What it writes, and what it will not overwrite

An off `redistill` is an **absent key**, not `"redistill": null`: 0.2.x rejects any key it does not
know, and it rejects the whole file, so writing an inert null would take a returning user's summarizer
model and thinking level with it. A file this version writes is readable by 0.2.x unless it carries a
configured `redistill`; to go back to 0.2.x, remove that key.

A half-configured `redistill` — one threshold, or a value that is not a whole number in range — is
validated field by field, so the field that is there is checked even though the pair is off. Because
`redistill` is file-only, a `/compaction …` save **refuses** rather than erase a `redistill` the
configuration does not adopt: the change is not applied, the file is untouched, and the message says
to complete the pair or remove it.

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

## Degrading to a fallback summarizer

Handing compaction back to stock Pi gives up the summarizer you configured: stock Pi compacts with
the **conversation model** at the **session's thinking level**. What the owner's machine has recorded
for compactions on a summarizer chosen for the job — and what it could not re-derive — is in
[validation](docs/validation.md#measured-on-the-owners-machine).

`fallbackModel` puts one step in between. It is off by default, and `null` — or an absent field — is
exactly the behaviour above.

### Resolution order

`summarizerModel` → `fallbackModel` → hand back to the host. One fallback, never a list: a chain is a
policy nobody can reason about, and the step after it is the host anyway.

The fallback attempt gets the **same kept window** as the primary — it is a different model, not a
different compaction.

It does **not** necessarily get the same thinking level. The level is clamped against the model that
runs, so a fallback whose `thinkingLevelMap` cannot honour the configured level runs at a different
one, and the announcement names the level that actually ran rather than the one you asked for:

```text
Now: the summarizer configured here did not run. This summary is the fallback's, over the same kept
  window and at thinking level high (clamped from medium; the level is clamped per model), so the cut
  point and the whole-summary guarantee are unchanged — but the model you chose is not the one that
  wrote it.
```

### Which failures fall back

| Failure | Falls back? |
| --- | --- |
| This host does not offer the summarizer model | **yes** |
| The host has no configured credentials for it | **yes** |
| The summarizer reported an error (503, model unavailable, …) | **yes** |
| A partial or unobserved response | **yes** |
| A cancellation | no — `{cancel: true}`, and nothing is attempted |
| A host seam mismatch | no — a second model would fail identically |
| A cut point with nothing to summarise | no — there is no request to make |
| A rejected configuration | no — the file is refused whole and compaction stays stock Pi |

### The partial-summary guarantee still applies

A partial or unobserved response **from the fallback** is refused exactly as one from the primary is.
Nothing this package cannot vouch for is ever persisted, whichever model wrote it. After a refused
fallback attempt, compaction hands back.

### What it looks like

A fallback that produced the summary is not a handback, and is not announced as one:

```text
pi-compaction: recovered — the fallback summarizer produced the summary
Summarizer: mafia-g/gemini-3.8-flash (google-generative-ai)
Why: minimax-cn/MiniMax-M3.1-Flash (anthropic-messages) failed: the summarizer reported an error
  (503 model_unavailable); the fallback ran and its summary was complete
Now: the summarizer configured here did not run. This summary is the fallback's, at the same thinking
  level and the same cut point, so nothing else about the compaction changed — but the model you
  chose is not the one that wrote it.
```

A handback after both attempts names both of them:

```text
pi-compaction: degraded — compaction handed back to stock Pi
Summarizer: mafia-g/gemini-3.8-flash (google-generative-ai)
Why: the host has no configured credentials for it
Earlier: minimax-cn/MiniMax-M3.1-Flash (anthropic-messages) — the summarizer reported an error (503 model_unavailable)
Now: stock Pi compacts with the conversation model, …
```

With no fallback configured, the announcement is unchanged: one attempt, and nothing about a second
model.

### The record

A handback is recorded as the `pi-compaction-degradation` custom session entry, as before. A fallback
that produced the summary is recorded as **`pi-compaction-fallback`** — a distinct entry type, because
a fallback that ran is not a degradation and the entry type is what anything scanning the session
reads. Both carry every attempt in order, with the reason each one failed and the model that actually
ran, and `/compaction` reports them.

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
the kept-window target, whether redistilling is on and at what thresholds, whether the package is
enabled, and the result of the host-seam check. It does not shadow the host's `/compact`.

```text
Config: /home/you/.pi/agent/extensions/pi-compaction/config.json
Enabled: yes
Summarizer model: minimax-cn/MiniMax-M3.1-Flash (anthropic-messages)
Thinking: off
Fallback model: mafia-g/gemini-3.8-flash (google-generative-ai)
Kept window: 16000 tokens
Redistilling: off
Summary length: not bounded by this package — the host sends no output ceiling and neither do we
Host seam: ok — compact() arity 12; our stream function received {apiKey, cacheRetention, env, headers, sessionId, signal} and its result() was awaited
Last degradation: none in this session
```

The fallback line says what this host can actually run: `none`, the model and its API, or the reason
it could not — `not available on this host`, or `no configured credentials on this host`.

Every knob but one is settable from it, and each change is written back to the configuration file:

```text
/compaction enable | disable
/compaction model provider/model | conversation
/compaction fallback provider/model | conversation | none
/compaction thinking off | minimal | low | medium | high | xhigh | max
/compaction window <tokens>
```

`conversation` and `none` both mean no fallback, and the configuration file takes both as well as
`null` — the two entry points spell it the same way on purpose. There is deliberately no way to name
the conversation model as a fallback: the host handback already is that, and saying it twice would
hide which one happened.

`redistill` is the exception, and deliberately so: it is file-only. It ships inert and unvalidated, so
there is nothing to turn on from a command — see [Asking for a fixed point](#asking-for-a-fixed-point).

## Host-seam check

Four seams this package depends on are not documented extension APIs: the argument list of the host's
`compact()`, the point at which it calls its stream function, that it awaits `result()` on whatever
that function returns, and that `estimateTokens()` accepts a `compactionSummary` message and returns
its size. All four are verified at activation — the arity, an actual call through a stream function the
package supplies, and two sizes of a known message, none of which needs credentials or makes a request.
Tested signatures decide compatibility, not version text.

The first three carry compaction: a mismatch hands it back to the host instead of letting the package
misbehave, and the status view reports it. The third is the one the package reads a response's stop
reason through, which is how it refuses to persist a partial summary; losing it would not break
compaction — summaries would still be produced, just unchecked — so it is probed rather than assumed.

The fourth is narrower and is only used by [redistilling](#asking-for-a-fixed-point). A host that
stopped recognising the shape would report 0 or `NaN`, every summary would then read as below
`aboveTokens`, and redistilling would turn itself on for every compaction while naming a wrong number
— silently the opposite of inert. So a failed probe turns redistilling **off** and says so in
`/compaction`; compaction itself is unaffected, and a caller's own `/compact <text>` still reaches the
request.

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
