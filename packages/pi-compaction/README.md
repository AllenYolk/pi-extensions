# @allenyolk/pi-compaction

Bounded Pi context compaction. Pi's native compaction issues its summary request with no output
ceiling at all, so the summary is bounded only by the summarizer model's own output limit, and the
summary is rewritten on every compaction, so it drifts upward by construction. This package puts a
number on it.

- The summary request carries a **hard ceiling** expressed as two absolute token values: a text
  budget and a reasoning budget. Neither is derived from the host's reserved-token setting, which
  only moves the compaction trigger.
- The **summarizer** — the request that produces the summary — gets its own model and its own
  thinking level, chosen independently of the conversation model and the session's thinking level.
- The **kept window** — the most recent entries a compaction retains verbatim — is the extension's
  own token target rather than the host's recent-token setting, so base context is a number you
  control.
- **Pruning** shrinks context between compactions by replacing an old tool result with a bounded
  placeholder, keeping the originating tool call. No model call and no summary, and it only runs when
  invalidating the provider prompt cache is already free.
- The read-files and modified-files blocks are **bounded**, and a summary this package produces does
  not inherit the previous compaction's lists.

The package ships **inert**. Installing it changes nothing until you enable it.

## Configuration

One JSON file in the Pi agent directory, at `extensions/pi-compaction/config.json`. There are no
project-level overrides, and `/reload` picks up a change without restarting.

```json
{
  "enabled": true,
  "preset": "balanced",
  "summarizerModel": null,
  "keptWindowTokens": 16000,
  "prune": true,
  "pruneWindowTokens": 16000,
  "neverPrune": ["bash", "edit", "write", "subagent"]
}
```

| Field | Meaning |
| --- | --- |
| `enabled` | Whether the package acts at all. Defaults to `false`. |
| `preset` | `fast`, `balanced`, `deep`, or `off`. `off` returns compaction to stock Pi. |
| `summarizerModel` | `provider/model`, or `null` — the default — for the conversation model. `"conversation"` is accepted as a spelling of `null`. |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Overrides the preset, and is clamped to what the chosen model supports. |
| `textBudget` | Absolute output allowance for the summary text. Overrides the preset. |
| `reasoningBudget` | Absolute output allowance for the summarizer's reasoning. Overrides the preset; `0` means the summarizer does not reason. |
| `keptWindowTokens` | Token target for the kept window. Defaults to `16000`. |
| `prune` | Whether pruning runs. Defaults to `true`, and is independent of the preset: pruning works with `off`, and `prune: false` leaves the summarizer alone. |
| `pruneWindowTokens` | How much recent tool-result context pruning protects. Defaults to `16000`. |
| `neverPrune` | Tool names whose results are never pruned. Defaults to the list below. |

An invalid value is rejected whole: the package reports the file and the field, and compaction stays
stock Pi rather than half-applying a configuration.

### Presets

| Preset | Summarizer model | Thinking | Text budget | Reasoning budget |
| --- | --- | --- | --- | --- |
| `fast` | the conversation model | off | 6,000 | 0 |
| `balanced` (default) | the conversation model | medium | 12,000 | 8,000 |
| `deep` | the conversation model | high | 12,000 | 24,000 |
| `off` | — | — | — | — |

All three presets summarise with the conversation model, so the default path never depends on a
second provider being signed in and there is no "configured but not authenticated" surprise. They
differ in thinking level and in the two budgets.

The four preset names and the four fields they carry are public configuration from the first
release; changing the tuple's shape later is a breaking change. A preset is the whole tuple, so
switching presets from the command drops any per-field overrides.

### Optional cheap summarizers

A cheaper or faster summarizer is an explicit choice, and R1 is a full feature: `/compaction model
provider/model` and the `summarizerModel` field both work, and the request then goes to that model
instead.

```sh
/compaction model minimax-cn/minimax-M3.1-Flash
```

`minimax-cn/minimax-M3.1-Flash` and `mafia-g/gemini-3.8-flash` are the two the owner has in mind.
Neither is a default and neither is required. The chosen model must be one this host offers with
configured credentials; if it is not, the package says so and hands compaction back to Pi rather
than failing the compaction.

## Pruning

A **prune** shrinks context by replacing an old tool result with a bounded placeholder, keeping the
originating tool call. It is not a compaction: there is no model call, no summary and no waiting.

It is recorded as a persisted `context_edit` session entry carrying a **replacement**, per
[ADR 0002](docs/adr/0002-prune-durably-not-per-request.md). The alternatives were rejected for
concrete reasons: a rewrite of the outgoing message list never reaches the host's session
projection, so one of its two compaction triggers would not see the prune; and `replacement: null`
omits the entry, which removes the result while leaving the originating tool call in place — the
host does not repair that orphan and providers reject the shape.

The raw entry is never modified. A pruned result is still on disk in the session file, byte for byte
— but nothing in this package reads it back, because a recall tool is out of scope. **Recovery is by
re-running the tool**, which is what makes the never-prune list a correctness requirement rather than
a tuning knob.

### The placeholder

```text
[pi-compaction pruned this tool result]
Tool: read
Arguments: {"path":"/src/session.ts"}
Omitted: 41203 of 41803 characters.
Excerpt (first 600 characters):
…
Re-run `read` with those arguments to recover the full result; it is unchanged on disk in this session.
```

It names the tool, carries a short digest of the arguments so a re-run is actually possible, states
how much was omitted and keeps a bounded excerpt. It does not repeat the full arguments: they are on
the preserved tool call, which is the thing that makes the result recoverable. A result whose
placeholder would not be smaller than its own text is left alone.

### The never-prune list

A pruned result is recoverable only by re-running its tool, and there is no recall tool. Results of
one-shot and side-effecting tools — a subagent's answer, a `bash` that mutated state, a network
fetch whose response has since changed — are information the session cannot get back. Pruning one is
loss, not compression.

The default list:

```text
ask_user_question, bash, codemode, edit, fetch_content, powershell,
source_check, subagent, web_search, write
```

Every other tool's results are prunable, so a tool this list does not name is one you have judged
re-runnable. That includes MCP tools, whose semantics this package cannot know: add them to
`neverPrune` if yours are not safe to re-run. The list is enforced by name, whatever a result's size
or age, and `/compaction never-prune none` really does empty it — the status view says what that
costs rather than showing it as the default.

### The two gates

Either gate permits a prune; with neither, nothing is pruned.

The measured gate asks whether the **next** request would read the cache — not whether the last one
did. That distinction is the whole gate: a request that *wrote* prompt tokens left an entry the next
request would read, so pruning there throws away a prefill that was just paid for. It is the most
expensive moment to prune, not the cheapest. The usage the host recorded for the previous request
answers the question directly, so this is a measured fact rather than a clock and it self-calibrates
across providers whose cache lifetimes differ.

| The previous request | What the next request would do | Prune? |
| --- | --- | --- |
| read cached prompt tokens | read the same warm prefix | no — `prefix-read-from-cache` |
| wrote prompt tokens, read none | read the entry just written | no — `prefix-just-written` |
| neither read nor wrote | nothing cached to hit | **yes** — `nothing-cached` |
| reported no usable usage | unknown | the clock fallback, below |
| no completed request observed yet | nothing says what the next one would read | no — `no-request-observed` |

The three cache facts stay distinct in the status view, because they cost different amounts and
"warm" on its own hides the case that matters most.

- **Compaction is imminent**, tested with the host's own threshold and its own resolved
  `compaction.reserveTokens`. The prefix is about to be destroyed, so invalidating it is free.

A clock threshold exists only as a **fallback** for a session in which no request reports usable
usage at all — five minutes, the same prompt-cache TTL the host itself assumes, measured from the
most recent request. It never overrides measured usage in any direction, and the status view labels
it as the fallback when it is what armed the prune.

### What this means on a provider with prompt caching

Plainly: **on a session whose provider caches the prompt, the measured gate does not fire.** Every
request either reads the prefix back or writes the entry the next request will read, so there is
never a free moment between compactions — which is exactly the finding, not a defect in it.

Pruning on such a session therefore runs when **compaction is imminent**: once per compaction cycle,
just before the host would compact, where the prefix is about to be destroyed and invalidating it
costs nothing. That is still worth doing — it shrinks what the summarizer has to read, and it can
take the session back under the trigger and avoid the compaction entirely. The status view shows the
gate standing down to `prefix-read-from-cache` or `prefix-just-written` immediately afterwards,
because a context edit makes the host re-account from the projection and this session is no longer
at the trigger.

On a provider that reports no cache activity — most OpenAI-compatible endpoints, local models, many
gateways — the measured gate fires freely, because there is no cache to protect. If you expected
pruning to run continuously on a caching provider, it will not, and that is deliberate.

Pruning targets the oldest results beyond the protected window: the position that saves the most
tokens and invalidates the most cache — acceptable precisely because a gate had to permit it. All of
a turn's edits are appended together from one turn boundary, so a turn costs one cache invalidation
rather than one per pruned result.

### The window

`pruneWindowTokens` is the one knob, denominated in tokens of recent tool-result context. Walking
back from the newest result, a result is protected while the results newer than it are still worth
fewer than that many tokens; everything older is a candidate.

At the edges: a window of `0` protects nothing, including the results of the turn that just ended,
which can make the model re-run tools it has only just called — the default exists to prevent that.
A window larger than the session's tool results prunes nothing at all.

## What the two budgets mean on each provider API

The host hands its summarization request options straight through, with no output ceiling of its
own, and this package's wrapper adds the two budgets. What the provider then does with them depends
on the model's API. The adapters below were read for whether they consume `thinkingBudgets` and
which output field they emit; they fall into four shapes. Any other API — a newer adapter, or one
this package has not read — is treated as a single pool, which asks for a summed ceiling rather than
only the text budget.

### Answer budget — `anthropic-messages`, `bedrock-converse-stream`

`maxTokens` is the answer budget and the adapter adds the thinking budget on top of it, capped by
`thinkingBudgets`. The package therefore passes the text budget as the output option and the
reasoning budget as the thinking budget, so the envelope is `textBudget + reasoningBudget` and
thinking cannot exceed `reasoningBudget`.

Because thinking is capped at the reasoning budget and the envelope is their sum, **at least
`textBudget` of room is guaranteed to remain available for text**. That is a guarantee about the room
left, not a floor on what the model writes: nothing here makes the model produce a particular amount
of text.

### Single pool — `openai-responses`, `azure-openai-responses`

`thinkingBudgets` is **ignored by the adapter**. It only sends `reasoning.effort`, which is a level
and not a token cap. The reasoning budget therefore has **no enforcement power here at all** — it
only inflates the pool the package asks for. The pool is `textBudget + reasoningBudget`, reasoning
draws from it uncapped, and so **the text has no independent ceiling**. This is why the status view
labels the reasoning budget advisory on these APIs: the adapter genuinely does not look at the field.

### Single pool with a honoured thinking budget — `openai-completions`

The pool is `max_tokens` or `max_completion_tokens` and reasoning shares it, as above. This adapter
does read `thinkingBudgets`: it clamps the budget to leave answer room against
`max_tokens ?? max_completion_tokens ?? model.maxTokens` and sends it as a top-level
thinking-token-budget field — but only when the model's compatibility settings declare such a field
(`compat.thinkingTokenBudgetField`, or `compat.supportsThinkingTokenBudget` for the default
`thinking_token_budget` name). When they do, thinking is capped by the reasoning budget and at least
`textBudget` of room remains available for text, as on an answer-budget API. When they do not, it
behaves like the single pool above. The status view reports which of the two applies to your model.

### No output ceiling — `openai-codex-responses`

This adapter sends **no output-ceiling field whatsoever**. Its request body carries `model`, `store`,
`stream`, `instructions`, `input`, `text`, `include`, `prompt_cache_key`, `tool_choice` and
`parallel_tool_calls`, plus optional `temperature`, `service_tier`, `tools` and a reasoning effort.
There is no `maxTokens` reference anywhere in the file, so a ceiling handed to it is **silently
dropped** — the exact failure this package exists to prevent.

The package will not pretend otherwise. With a summarizer on this API the status view says the
ceiling cannot be enforced and names the API, and the hook degrades before any request rather than
producing a summary it cannot bound. Proceeding would mean claiming a bound we do not have, which is
worse than being inert.

### Untested — `google-generative-ai`, `google-vertex`

The adapter does honour the field: it becomes `thinkingConfig.thinkingBudget`, separate from
`generationConfig.maxOutputTokens`, which carries the text budget. Whether the provider counts
thinking tokens against `maxOutputTokens` is provider behaviour, and this package has not tested it,
so the resulting envelope is either `textBudget` or `textBudget + reasoningBudget`. The status view
marks this API provider-dependent. Verify against your provider before relying on a number.

It is classified as an answer-budget API, so the retry ladder's answer-budget rung applies: a retry
halves both budgets.

## What changes

Measured on the owner's profile, with the host's prompt and tool declarations at 34,874 tokens — a
constant this package cannot reduce, because it adds no tools of its own — a 15,340-token kept
window at the 16,000 target, and a 239,232-token compaction trigger (a 272,000-token context window
less 32,768 reserved tokens):

| Preset | Pool | Text ceiling | Base context | Growth per cycle | Guarantee |
| --- | --- | --- | --- | --- | --- |
| `fast` | 6,000 | 6,000, hard | ≤56,214 | ≥183,018 | holds by construction |
| `balanced` | 20,000 | 20,000 | ≤70,214 | ≥169,018 | construction upper bound |
| `deep` | 36,000 | 36,000 | ≤86,214 | ≥153,018 | construction upper bound |

Every clause of the following holds by construction:

- The summary goes from **unbounded** — the summarizer model's own output limit, 128,000 — to
  **bounded**: 6,000, 20,000 or 36,000.
- Base context goes from a measured **93,152** to **≤56,214 / ≤70,214 / ≤86,214**.
- Growth per cycle goes from **112,464** to **≥183,018 / ≥169,018 / ≥153,018**.

The 112,464 baseline was measured against an earlier 206,464-token trigger, before the reserved-token
change; the three bounded figures are derived from today's 239,232-token trigger. The like-for-like
baseline at that trigger is 146,080 (239,232 less the same measured 93,152 base context), so the
growth-per-cycle gain is real but smaller than the two columns side by side suggest.

`fast` is the only preset whose number is a promise rather than a bound: its reasoning budget is
zero, so nothing else competes for the pool and 6,000 is a hard ceiling on the text. That is why the
three presets are not redundant — `balanced` and `deep` buy a thinking phase, and pay for it with the
certainty that the text may use whatever the thinking phase leaves.

The status view computes the same figures from your own configured kept-window target, so its
numbers move with that setting.

Beyond the request, the package refuses to persist a summary longer than the text budget. That refusal
is not the end of it: see the retry ladder below.

## The retry ladder

A hard ceiling on a model that wants to write more produces a **length stop**, and a model that
ignores the budget produces a summary **over the text budget**. Both used to end in the same place —
warn, and hand compaction back to stock Pi, which is the unbounded summary this package exists to
remove. So the package's own guardrail no longer routes into the bug it was built to fix.

1. Attempt with the preset's model, thinking level and both budgets.
2. On a length stop, or on a summary over the text budget, retry **once** with a tighter
   configuration.
3. On any further failure — a second length stop, a model error, a timeout, a malformed result —
   degrade to stock Pi.

The retry is **two rungs, not a loop**: the configuration list is a fixed array, so there is no third
attempt to reach however the second one fails.

### The tighter configuration depends on the API class

The difference is whether the reasoning budget reaches the provider as a token cap.

| Class | Why a length stop happened | The retry |
| --- | --- | --- |
| Answer budget | `thinkingBudgets` is honoured, so the thinking phase may simply have eaten the quota the text needed | **Compress both budgets**: text budget and reasoning budget are each halved, so the envelope shrinks with them and the provider enforces the smaller text budget itself |
| Single pool | The adapter never reads `thinkingBudgets`, so reasoning drew from one envelope uncapped and the envelope really was exhausted | **Drop the reasoning draw**: thinking off, and an explicit budget instruction appended to the request. The envelope is left at the pool |
| No ceiling | — | Never reaches the ladder; handed back before any request |

Halving is the aim, not a new contract. **Both attempts are judged against the preset's own text
budget**, so the persisted summary is always inside the number you configured; the retry's smaller
budgets only shape the request.

Leaving the envelope alone on a single pool is deliberate. The acceptance test is on the text, and a
model told to stay inside the text budget still needs room to *stop cleanly* rather than hit the cap
again — shrinking the envelope there would make the second length stop more likely, not less.

### The budget instruction

The host appends `customInstructions` to its summarization prompt as an "Additional focus" section,
which is the only place a budget can be stated in words on an API whose ceiling is one pool the
adapter will not divide. Only the single-pool retry uses it:

```text
Additional focus: Keep the entire summary within 12000 tokens. An earlier attempt ran past its
output ceiling and was discarded, so write a shorter summary rather than an incomplete one: drop
detail, and keep exact file paths, function names and error messages.
```

Any custom instructions the compaction already carried are kept, and this is appended after them.

### What is never persisted

A truncated or partial summary is never persisted, at any step, including from a retry:

- The host throws on a length stop and on a tool call, so those never reach a result at all.
- The package additionally refuses any response whose `stopReason` is not a clean stop, read from the
  response itself through the stream function it owns — the host returns a partially written summary
  unchanged for a stop reason it does not recognise.
- A summary over the preset's text budget is refused, from either attempt.

A cancellation stops everything. It is checked before every attempt, after every attempt and before
every handback, and it answers `{cancel: true}`: no retry, and never a fallback that begins a fresh
compaction behind your back.

## Degradation

Degradation is handing compaction back to stock Pi after the package's own attempts fail. It is never
silent, and it is the same announcement whatever caused it: a host seam mismatch, an unavailable
summarizer model, missing credentials, a no-ceiling API, a model error, a summary over the text
budget, or a second length stop.

```text
pi-compaction: degraded — compaction handed back to stock Pi
Preset: balanced — summarizer mafia-o/gpt-6.1-sol (openai-responses)
Why: the summarizer hit its output ceiling, so the summary was incomplete, and after a tighter retry
  (thinking off and an explicit 12000-token budget instruction, with the envelope unchanged) the
  summarizer hit its output ceiling, so the summary was incomplete
Now: stock Pi sends no output ceiling at all, so the summary is bounded only by the summarizer
  model's own output limit. Measured on the profile this package was built against, summaries grew
  3,437 to 26,019 tokens across 16 compactions, each taking 289 to 490 seconds, and base context grew
  with them.
Next: /compaction preset fast for a hard 6,000-token ceiling, /compaction model provider/model for a
  summarizer on an answer-budget API, or /compaction disable to make this the default.
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
enters the summary or the model's context, and `/compaction` reports it as `Last degradation:` for as
long as the session lives.

What is *not* durable is the rendering of that entry in the transcript. Drawing it would mean
registering a TUI component, which would add `@earendil-works/pi-tui` as a peer dependency to a
package that deliberately has none. The widget carries the visible announcement and the session entry
carries the record; `/compaction` is how you read the record afterwards.

## `/compaction`

`/compaction` on its own shows the effective preset, summarizer model, thinking level, both budgets,
what the provider will actually receive, whether the reasoning budget is enforced on that API, the
worst-case summary and base context, the kept-window target, whether the package is enabled, and the
result of the host-seam check. It does not shadow the host's `/compact`.

```text
Config: /home/you/.pi/agent/extensions/pi-compaction/config.json
Enabled: yes
Preset: balanced
Summarizer model: mafia-o/gpt-6.1-sol (openai-responses)
Thinking: medium
Text budget: 12000
Reasoning budget: 8000
Outbound: single-pool API openai-responses — the provider sees an output ceiling of 20000
Reasoning budget on this API: advisory — openai-responses sends a reasoning effort level, not a
  token cap, so the reasoning phase draws uncapped from the same pool and the text has no
  independent ceiling
Worst case: summary 20000 tokens; base context 34874 + 20000 + 16000 = 70874 tokens
Kept window: 16000 tokens
Prune: on
Prune window: 16000 tokens of recent tool results
Never prune: ask_user_question, bash, codemode, edit, fetch_content, powershell, source_check, subagent, web_search, write
Prune gate: blocked (prefix-read-from-cache) — the previous request read 58278 cached prompt tokens, so the next request would read the same prefix
Host seam: ok — compact() arity 12; our stream function received {apiKey, cacheRetention, env, headers, sessionId, signal}
Last degradation: none in this session
```

The gate line says whether pruning is armed right now, names the fact that decided it, and gives the
reason — or, when it is blocked, which of the three cache facts is blocking it.

Every knob is settable from it, and each change is written back to the configuration file:

```text
/compaction enable | disable
/compaction preset fast | balanced | deep | off
/compaction model provider/model | conversation
/compaction thinking off | minimal | low | medium | high | xhigh | max
/compaction text <tokens>
/compaction reasoning <tokens>
/compaction window <tokens>
/compaction prune on | off
/compaction prune-window <tokens>
/compaction never-prune <tool>[,<tool>…] | default | none
```

## Host-seam check

Two seams this package depends on are not documented extension APIs: the argument list of the host's
`compact()` and the point at which it calls its stream function. Both are verified at activation —
the arity, and an actual call through a stream function the package supplies, which needs no
credentials and makes no request. A mismatch degrades to the host instead of letting the package
misbehave, and the status view reports it. Tested signatures decide compatibility, not version text.

## Install

Not yet published to npm — the first release, `0.1.0`, is a candidate. Take it from the
[pi-extensions collection](../../README.md#install), or load it for one run:

```sh
pi -e ./packages/pi-compaction/src/index.ts
```

## Status

The first release is `0.1.0`, a candidate; the manifest carries `0.0.0` until the pending changeset is
applied in a version PR, which is what produces `0.1.0` as the first published version. Its
development host, and the host its checks run against, is
`@earendil-works/pi-coding-agent` 1.5.1 — the version whose seams were inspected. It adds no tools,
so it does not change the host's prompt and tool declarations, and it never patches the host, edits
an installed Pi or changes the host's compaction settings. It has no runtime dependencies and no peer
dependency beyond the host itself.

There is no recall tool for pruned content: recovery is by re-running the tool, which is why the
never-prune list is enforced.

Tested platforms, known limits, rollback instructions, independent-review status and the list of what
is *not* established live in [validation](docs/validation.md).
