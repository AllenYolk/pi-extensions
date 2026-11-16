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
| `--arm <provider/model>@<thinking>` | One arm. Repeatable, and a comparison needs at least two. |
| `--score <summary.md \| run.json>` | Score a summary, or every arm of a run a live run wrote. Repeatable. |
| `--fixture <manifest.json>` | Defaults to `eval/fixtures/long-session.json`. |
| `--session <path>` | Live only: read the session from this path instead of the fixture's own. |
| `--out <dir>` | Live only: where `run.json` and one file per summary are written. Defaults to `./work/`. |
| `--json` | Emit the run record instead of the table. |

Exit status is **0** when every arm stopped with `stop`, **1** when an arm did not, and **2** for bad
usage. A summary passed to `--score` was never a response, so it carries no stop reason and cannot
fail the first rule.

The control arm — the one every `Δ out` is measured against — is the first arm on the command line.
Put the arm you are trying to beat first.

## What is scored

Everything is deterministic. There is no model in the scorer: a model grading a model's summary is
not reproducible and cannot gate anything.

| Metric | Definition |
| --- | --- |
| `sections` | How many of the nine headings the host's summarization prompt asks for the summary carries (`## Goal`, `## Constraints & Preferences`, `## Progress`, `### Done`, `### In Progress`, `### Blocked`, `## Key Decisions`, `## Next Steps`, `## Critical Context`). Heading level is not matched — a summary that writes all nine at one level has still written all nine. |
| `fabricated` | Distinct file paths the summary names that the summarised range does not contain. The range is what the summarizer was actually given, so a path that only occurs in a part of a tool result the host truncated is counted as invented, which is the honest reading. A path needs a directory separator and a lettered extension, so `minimax-cn/MiniMax-M3.1-Flash` and `release/0.9` are not paths. |
| `probes` | How many of the fixture's declared probes the summary carries. A probe is a literal or a regex, never a model. |
| `Δ out` | Output tokens against the control arm. |

Recorded per arm from a live run, and shown as `—` for a scored summary that has none of them: wall
time, output tokens, reasoning tokens, cost, stop reason, and the summary text.

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
time and never written to the repository; probes the session does not contain are reported and left
out of the score rather than counted as lost.

## What a live run costs

One arm sends roughly 3,800 input tokens — the ~3,000-token summarised range, the previous summary
and the host's summarization prompt — and gets back whatever the model writes, typically 600 to 1,500
tokens for a range this size. So a two-arm comparison is a few thousand input and output tokens per
arm.

At the rates behind the table in `docs/validation.md`, that is **cents, not dollars**: the owner's
$1.42 conversation-model arm was measured on a range about six times this size. The exact figure
depends entirely on the models you name — check their prices before you run it, and remember that a
thinking level the model does not support is clamped upward, which is where an unexpectedly expensive
arm usually comes from.

A live run needs the models to be ones this host offers with configured credentials. An arm it cannot
resolve is recorded with the reason and fails the exit status; the other arms still run, so a
comparison is not lost to one bad model name.

## Why the live mode is not in `npm run check`

It costs money, it needs credentials, and its result depends on what a provider served that minute.
The scorer has none of those properties, which is why `--score` is what the unit tests drive and the
live mode is a command a person runs on purpose.
