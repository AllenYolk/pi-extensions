# The evaluation harness

One fixed input, several summarizer configurations, one scorer. It exists so that a change to this
package can be checked against something: `docs/validation.md` records what the owner's machine
measured, and this is the version of that measurement anyone can re-run.

It is **not** part of the published package — `files` in `package.json` is `src`, `README.md` and
`LICENSE`, so nothing under `eval/` reaches the tarball.

## Two modes

```sh
# Score a summary that already exists. No credentials, no network, no request.
node eval/harness.ts --score summary.md

# Produce the summaries first. Live: needs credentials, costs money, never run by CI.
node eval/harness.ts \
  --arm 'mafia-o/gpt-6-astra@high' \
  --arm 'minimax-cn/MiniMax-M3.1-Flash@low' \
  --out work/run-1
```

| Flag | Meaning |
| --- | --- |
| `--arm <provider/model>@<thinking>[+<aboveTokens>:<targetTokens>]` | One arm. Repeatable, and a comparison needs at least two. The optional `+` suffix asks the summarizer to re-distil a previous summary of at least `aboveTokens` tokens towards `targetTokens` — the same instruction, from the same module, that the hook sends when `redistill` is configured. |
| `--score <summary.md \| run.json>` | Score a summary, or every arm of a run a live run wrote. Repeatable. |
| `--fixture <manifest.json>` | Defaults to `eval/fixtures/long-session.json`. |
| `--session <path>` | Live only: read the session from this path instead of the fixture's own. |
| `--out <dir>` | Live only: where `run.json` and one file per summary are written. Defaults to `./work/`. |
| `--json` | Emit the run record instead of the table. |

Exit status is **0** when every arm stopped with `stop`, **1** when an arm did not, and **2** for bad
usage or unusable input — an unknown argument, a single arm, an arm naming a thinking level that does
not exist, a missing fixture, a manifest whose probes do not occur in its own session, a run record
that is not one, or a recorded session that has since been deleted. `--help` is none of those: it
prints this usage on stdout and exits **0**.

A summary passed to `--score` was never a response, so it has no response groups and cannot fail the
first rule.

The control arm — the one every `Δ out` is measured against — is the first arm on the command line
that reported output tokens. Put the arm you are trying to beat first. An arm that never ran — a
model this host does not offer, missing credentials, a thrown request — reports no output tokens, so
the baseline falls back to the first arm that does; when that happens a line on stderr names the arm
`Δ out` was measured against, because the table cannot show it.

## Redistilling arms

An arm may carry the two thresholds `redistill` takes, as `+<aboveTokens>:<targetTokens>`:

```sh
node eval/harness.ts \
  --arm 'minimax-cn/MiniMax-M3.1-Flash@low' \
  --arm 'minimax-cn/MiniMax-M3.1-Flash@low+200:400' \
  --out work/redistill-1
```

The instruction comes from `src/redistill.ts` — the module the hook itself uses — so an arm measures
what the package would actually ask for, and `run.json` records the text each arm sent. The thresholds
go through the configuration's own bounds, so an arm cannot measure an instruction naming a number the
package would refuse to send, and a split turn is left alone here for the same reason the hook leaves
it alone.

An arm whose `aboveTokens` is above the previous summary's size asks for **nothing**, which makes it
the control arm under another name. The harness prints that on stderr, with the previous summary's
size. The committed fixture's previous summary is 261 tokens, so #31's own 4,000-token threshold does
exactly that; see [The redistilling experiment](../docs/validation.md#the-redistilling-experiment) for
the two ways to run it honestly.

## Stop reasons, and why every group counts

An arm records `stopReasons`: **one entry per response group**, in order, and `null` for a group whose
response carried no stop reason at all. An arm is clean only when it produced at least one group and
every one of them stopped with `stop`.

A split turn makes **two** summarization requests through the same stream function, and the host
concatenates both into one summary. Reading only the last group would score a half-written summary as
a clean one — a partial history response followed by a clean turn-prefix response is exactly the case
the hook in `src/index.ts` refuses to persist, and the harness refuses to score as a pass. The stop
column shows every distinct group outcome, so a split turn reads `aborted,stop` rather than `stop`.

## Re-scoring a run

`run.json` records the fixture **and the session** the run summarised, and `--score run.json` scores
against both. That is what makes `--session` usable: a run over a real session is re-scored over that
session, not over the synthetic fixture — which would turn the session's real paths into fabrications
and the probes it does not contain into probes the summarizer "lost".

The manifest is still held to its own probes: if the range is the session the manifest declares, a
probe that does not occur in it is an error rather than a score of zero. Only a session the operator
substituted gets the softer treatment, where absent probes are listed on stderr and left out of the
score.

## What is scored

Everything is deterministic. There is no model in the scorer: a model grading a model's summary is
not reproducible and cannot gate anything.

| Metric | Definition |
| --- | --- |
| `sections` | How many of the nine headings the host's summarization prompt asks for the summary carries (`## Goal`, `## Constraints & Preferences`, `## Progress`, `### Done`, `### In Progress`, `### Blocked`, `## Key Decisions`, `## Next Steps`, `## Critical Context`). Heading level is not matched — a summary that writes all nine at one level has still written all nine. |
| `fabricated` | Distinct file paths the summary names that the summarised range does not contain. The range is what the summarizer was actually given, so a path that only occurs in a part of a tool result the host truncated is counted as invented, which is the honest reading. Containment is a segment-boundary suffix test: a range naming `src/cache/spill.rs2` does not clear a summary that invented `src/cache/spill.rs`, while a range naming `/home/u/proj/src/index/manifest.ts` does clear a summary that names `src/index/manifest.ts` — the summarizer abbreviated a path that was there rather than inventing one, and a `--session` range is raw session text full of absolute tool paths. A path needs a directory separator and a lettered extension, so `minimax-cn/MiniMax-M3.1-Flash` and `release/0.9` are not paths. |
| `probes` | How many of the fixture's declared probes the summary carries. A probe is a literal or a regex, never a model. |
| `Δ out` | Output tokens against the control arm. |

Recorded per arm from a live run, and shown as `—` for a scored summary that has none of them: wall
time, output tokens, reasoning tokens, cost, every response group's stop reason, and the summary
text. A field the host's response did not report stays unrecorded rather than becoming a measured
`0`, so an arm that was never measured reads `—` and its `Δ out` is unavailable rather than a number
computed against a zero.

## The thinking level an arm runs at

An arm's level is one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` — `THINKING_LEVELS`
in `src/config.ts`, the same list the configuration validates against and the summarizer clamps
through, imported rather than copied. A level outside that set is refused as bad usage, naming the
level and the supported set: `summarizerThinkingLevel` clamps whatever it does not recognise to the
model's first available level, so accepting one would measure the arm at a level nobody asked for,
typically `off`, and say nothing about it.

A level that **is** one of the seven but that the model does not support is a different case, and is
still clamped the way the host clamps it — that is the model's own limit, it is recorded as the level
that ran, and it is where an unexpectedly expensive arm usually comes from.

## The fixture

`eval/fixtures/long-session.json` declares the session, the previous summary, the kept-window target
and the probe set. Everything in it is **synthetic**: a fictional debugging session about a service
called tessera, written for this harness. No real session content is committed here, and none should
ever be.

- `long-session.jsonl` — 59 session entries, about 4,800 host-estimated tokens.
- `long-session.previous.md` — the previous checkpoint, so every arm runs the host's *update* prompt
  at a fixed compaction ordinal. That is one of the two confounders the owner's ad-hoc numbers had to
  control for by hand.
- 29 probes: commit hashes, environment variable names, measured numbers, stated constraints, named
  mechanisms, file paths, an error string. Each one is checked to occur in the summarised range when
  the fixture loads — a probe the input does not contain is an unwinnable test, and loading fails
  rather than scoring it zero.

The cut point comes from this package's own `prepareCompaction`, at the fixture's declared
`keptWindowTokens` of 2,000, so the summarised range is about 3,000 tokens and the same range is used
for every arm and for every `--score`. The fixture is deliberately much smaller than the workload
`docs/validation.md` reports on: it is sized so a full comparison costs cents.

To measure a real session instead, pass `--session <path>` to a live run. The session is read at run
time and never written to the repository; the run records which session it summarised, so re-scoring
it later uses that same session. Probes the session does not contain are reported and left out of the
score rather than counted as lost.

## What a live run costs

One arm sends roughly 3,800 input tokens — the ~3,000-token summarised range, the previous summary
and the host's summarization prompt — and gets back whatever the model writes, typically 600 to 1,500
tokens for a range this size. So a two-arm comparison is a few thousand input and output tokens per
arm.

At the rates behind the table in `docs/validation.md`, that is **cents, not dollars**: the owner's
$1.42 conversation-model arm was measured on a range about six times this size. The exact figure
depends entirely on the models you name — check their prices before you run it.

A live run needs the models to be ones this host offers with configured credentials. An arm it cannot
resolve is recorded with the reason and fails the exit status; the other arms still run, so a
comparison is not lost to one bad model name.

## Why the live mode is not in `npm run check`

It costs money, it needs credentials, and its result depends on what a provider served that minute.
The scorer has none of those properties, which is why `--score` is what the unit tests drive and the
live mode is a command a person runs on purpose.
