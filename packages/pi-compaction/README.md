# @allenyolk/pi-compaction

Bounded Pi context compaction. Pi's native compaction issues its summary request with no output
ceiling at all, so the summary is bounded only by the summarizer model's own output limit, and the
summary is rewritten on every compaction, so it drifts upward by construction. This package puts a
number on it.

- The **summarizer** — the request that produces the summary — gets its own model and its own
  thinking level, chosen independently of the conversation model and the session's thinking level.
- The summary request carries a **hard ceiling** expressed as two absolute token values: a text
  budget and a reasoning budget. Neither is derived from the host's reserved-token setting, which
  only moves the compaction trigger. Their sum is the ceiling, because the host's output option does
  not mean the same thing on every provider API.
- The **kept window** — the most recent entries a compaction retains verbatim — is the extension's
  own token target rather than the host's recent-token setting, so base context is a number you
  control.
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
  "keptWindowTokens": 16000
}
```

| Field | Meaning |
| --- | --- |
| `enabled` | Whether the package acts at all. Defaults to `false`. |
| `preset` | `fast`, `balanced`, `deep`, or `off`. `off` returns compaction to stock Pi. |
| `summarizerModel` | `provider/model`, or `conversation` for the conversation model. Overrides the preset. |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Overrides the preset, and is clamped to what the chosen model supports. |
| `textBudget` | Absolute output ceiling for the summary text. Overrides the preset. |
| `reasoningBudget` | Absolute output ceiling for the summarizer's reasoning. Overrides the preset; `0` means the summarizer does not reason. |
| `keptWindowTokens` | Token target for the kept window. Defaults to `16000`. |

An invalid value is rejected whole: the package reports the file and the field, and compaction stays
stock Pi rather than half-applying a configuration.

### Presets

| Preset | Summarizer model | Thinking | Text budget | Reasoning budget |
| --- | --- | --- | --- | --- |
| `fast` | `minimax-cn/minimax-M3.1-Flash` | off | 6,000 | 0 |
| `balanced` (default) | `minimax-cn/minimax-M3.1-Flash` | medium | 12,000 | 8,000 |
| `deep` | the conversation model | high | 12,000 | 24,000 |
| `off` | — | — | — | — |

The four names and the four fields they carry are public configuration from the first release;
changing the tuple's shape later is a breaking change. A preset is the whole tuple, so switching
presets from the command drops any per-field overrides.

### How the two budgets reach the request

The host hands its summarization request options straight through, with no output ceiling of its
own, and the package's wrapper adds the two budgets. Where the output option is the answer budget
and the adapter adds the thinking budget on top — `anthropic-messages`, `bedrock-converse-stream`,
`google-generative-ai`, `google-vertex` — the text budget is the output option and the reasoning
budget goes through the host's per-level thinking-budget option, so their sum is the ceiling and the
text budget is a floor the reasoning phase cannot consume. Everywhere else the output option is one
pool covering reasoning and text, so the two budgets are passed as their sum. An API this package
has not read is treated as one pool, which bounds the request on every adapter.

A summary longer than the text budget is never persisted: the package says so and hands compaction
back to Pi rather than writing a summary it cannot bound.

## `/compaction`

`/compaction` on its own shows the effective preset, summarizer model, thinking level, both budgets,
the ceiling, the kept-window target, whether the package is enabled, and the result of the host-seam
check. It does not shadow the host's `/compact`.

Every knob is settable from it, and each change is written back to the configuration file:

```text
/compaction enable | disable
/compaction preset fast | balanced | deep | off
/compaction model provider/model | conversation
/compaction thinking off | minimal | low | medium | high | xhigh | max
/compaction text <tokens>
/compaction reasoning <tokens>
/compaction window <tokens>
```

## Host-seam check

Two seams this package depends on are not documented extension APIs: the argument list of the host's
`compact()` and the point at which it calls its stream function. Both are verified at activation —
the arity, and an actual call through a stream function the package supplies, which needs no
credentials and makes no request. A mismatch hands compaction back to the host instead of letting
the package misbehave, and the status view reports it. Tested signatures decide compatibility, not
version text.

## Install

Not yet published to npm. Take it from the [pi-extensions collection](../../README.md#install), or
load it for one run:

```sh
pi -e ./packages/pi-compaction/src/index.ts
```

## Status

Version `0.1.0`, a candidate. Its development host, and the host its checks run against, is
`@earendil-works/pi-coding-agent` 1.5.1 — the version whose seams were inspected. It adds no tools,
so it does not change the host's prompt and tool declarations, and it never patches the host, edits
an installed Pi or changes the host's compaction settings.

Not in this release: the retry ladder for a summarizer that hits its ceiling, the announced
degradation surface beyond the warning it already prints, and the no-summary prune path.
