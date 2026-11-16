# Validation

Release evidence for `@allenyolk/pi-compaction`, whose first release is `0.2.0`. This records what is
established today and, just as importantly, what is not. It is the release record CONTRIBUTING.md's
release checklist asks for; it is not a second status ledger.

A version PR for `0.1.0` was merged but never published — the package does not exist on npm. So `0.2.0`
is the first release a user can install, and the changelog describes the package rather than a diff
against a version nobody could obtain.

The spec is [issue #11](https://github.com/AllenYolk/pi-extensions/issues/11). That issue describes a
package that bounds the summary and prunes old tool results. Both were built, reviewed and then
removed; [ADR 0005](adr/0005-bound-by-not-bounding.md) records why, and the history is in
[Independent review](#independent-review) below. What ships chooses the summarizer model and its
thinking level, and refuses to persist a summary it cannot vouch for.

## Tested platforms and versions

Everything below was run on this machine. The gates were last run on the branch that removed the
output ceiling and the prune path.

| | |
| --- | --- |
| OS | macOS 26.6.2 (build 25G83), arm64 |
| Node | v24.18.0 |
| npm | 12.0.1 |
| PTY driver | `uv` 0.11.28 with CPython 3.12 |
| Compaction development host | `@earendil-works/pi-coding-agent` 1.5.1 (`pi-ai` 1.5.1) |
| Repository-root host | `@earendil-works/pi-coding-agent` 0.99.1 |

| Check | Result |
| --- | --- |
| `npm --workspace @allenyolk/pi-compaction run check` | typecheck clean; **71/71 tests pass** (45 behaviour, 26 evaluation harness) |
| `npm run check` | **157/157 tests pass** (71 compaction on Pi 1.5.1, 16 delete, 52 display, 18 repository on Pi 0.99.1) |
| `npm run benchmark` | **deliberately skipped** — the presentation benchmark is for `@allenyolk/pi-minimal-display`; this package registers no TUI component and patches nothing. CI runs it on every push regardless. |

The 26 harness tests are the scorers and the `--score` mode of [the evaluation harness](../eval/README.md).
They make no request: they read the committed fixture, score summaries that already exist, and spawn
the harness with `--score`. The live mode is unreachable without `--arm` and is not run by any check.

Which host proves what matters here. The package's own checks resolve Pi 1.5.1 from
`packages/pi-compaction/node_modules`, so every compaction assertion — including the real
packaged-CLI runs — is against 1.5.1. The repository-root checks resolve the root host, 0.99.1, and
exercise the package at the seams a collection user meets: it installs from its own packed tarball,
activates, deactivates on removal, stays inert when present and not enabled, coexists with the other
two extensions across repeated reloads, and installs from the git collection with and without a
resource filter. Compaction behaviour itself is **not** exercised on 0.99.1.

## The fallback summarizer

[Issue #30](https://github.com/AllenYolk/pi-extensions/issues/30) added `fallbackModel`. This section
records only what that change is and what was verified for it; the gates table above is unchanged by
it, and this branch's own run of both gates is noted at the end.

### What it changes about the degradation record

The record is no longer a single summarizer and a single reason. It is **every attempt the compaction
made, in order**, each with the model it was to run and — for the ones that failed — why. The last
attempt ran unless it carries a reason, which is the one predicate that decides everything else:

- a handback is still the `pi-compaction-degradation` custom entry, and a fallback that produced the
  summary is the new `pi-compaction-fallback` one, because the entry type is what anything scanning
  the session reads and a fallback that ran is not a degradation;
- a handback announces `degraded — compaction handed back to stock Pi` and gains an `Earlier:` line
  per attempt that failed before the last; a fallback announces `recovered — the fallback summarizer
  produced the summary` and names the failed attempts in its `Why:` line instead;
- `/compaction` reports `Last degradation: …` or `Last compaction: …` accordingly.

**With one attempt nothing changes**: the announcement is the same five lines with no fallback
wording, and the status line is the one `0.2.1` prints. An entry written by `0.2.1` — which has no
`attempts` — is skipped by the status view rather than crashed on, so a session that outlives the
version that compacted it still reads.

### What was tested

Every claim below is asserted against a real packaged-CLI run on a disposable profile and a synthetic
session, resolving Pi 1.5.1 from this package's own workspace, unless it says otherwise.

- `fallbackModel: null`, and an absent field, take the `0.2.1` path: one request of ours, then stock
  Pi's own, a host-originated compaction entry, the unchanged announcement, and a one-attempt record.
- Each of the four failures that fall back has its own run — the summarizer model is not offered by
  this host, the host has no configured credentials for it, the summarizer reported an error, and a
  partial response — asserting the request order, `fromHook: true` on the persisted compaction, the
  recovery announcement, and a two-attempt `pi-compaction-fallback` record.
- Both attempts failing hands back: the primary is not offered and the fallback has no credentials, so
  the only summarization request is the host's own, and the record names both attempts and both
  reasons.
- The whole-summary guarantee applies to the fallback: with both of our attempts returning a partial
  response there are three requests in order, the compaction that reaches the session is the host's,
  and the partial text is in neither the session file nor any persisted summary.
- A fallback is the same compaction with a different model: the two attempts' recorded prompts are
  byte-identical and both carry `reasoning: "low"`, which is the only way to show the cut point did
  not move between them.
- A rejected configuration stays inert — `fallbackModel: "no-slash"` rejects the file whole, and a
  hook-level run with a rejected file resolves no model and requests nothing.
- `/compaction fallback` with no value prints usage and changes nothing, an invalid id is refused by
  `validateConfig`, and the status view reports `none`, a model this host does not offer, a model with
  no configured credentials, and one it can run.
- A cancellation and a host seam mismatch each attempt nothing — see below.

### The two hook-level tests, and why they exist

`test/index.test.mjs` drives the registered hook directly against a compact function the test
supplies. Two properties cannot be decided by a real-host run:

- **A host seam mismatch.** `checkHostSeam` probes the host's own `compact()`, and Pi 1.5.1 passes, so
  the mismatch branch is unreachable from `cli.test.mjs`. The extension takes the compact function it
  probes *and* compacts with as a second argument — the injection `checkHostSeam` already had — and
  the test hands it one with nine parameters.
- **A cancellation reaching the fallback stream function.** The host will not start a request on an
  aborted signal, so a real run cannot tell this package's own guard apart from the host's. The
  test's compact function keeps calling whatever stream function it is handed, so only the package's
  guard can keep the fallback from running. The real-CLI cancellation test is kept as the
  end-to-end half: nothing persisted, no fallback request, no record.

### Mutation checks

Both hook-level properties were mutation-checked in the direction that matters, and both tests went
red:

- Removing the three `event.signal.aborted` reads in the attempt loop — before each attempt, in the
  catch, and after `compact()` resolves — makes the cancellation test report
  `['fixture/primary', 'fixture/fallback']` where one compaction was expected, and the fallback's
  stream function is reached.
- Letting a failed seam check fall through into the attempt loop instead of returning makes the
  seam test report `['find fixture/primary', 'auth primary', 'find fixture/fallback', 'auth fallback']`
  where no registry call at all was expected.

The real-CLI cancellation test was also checked and is **not** sensitive to the first mutation on its
own: with the same three guards removed it still passes, because the host refuses the second request
before a provider sees it. That is why the hook-level test exists rather than a stronger assertion on
the real run.

### Not established for the fallback

- **No measurement of what a fallback saves, and none is possible from this repository.** The owner
  recorded 36 s / $0.011 for the configured summarizer against 211 s / $1.42 for the handback, on the
  same conversation model and compaction ordinal, in
  [issue #28](https://github.com/AllenYolk/pi-extensions/issues/28). Those figures are **owner-recorded
  and not reproduced here**, and they are no longer re-derivable on this machine: the main-session
  files that carried the native `gpt-6-astra` compactions at ordinals 2–4 have been deleted, and the
  only native compactions still on disk are six inside `tasks/` subagent sessions from 2026-11-05 and
  2026-11-09. Nothing here measures a fallback step either.
- **Thirteen real compactions have produced zero degradations**, so no fallback has run on a real
  session. Every fallback path above is exercised against the fixture provider.
- **A fallback has not been observed against a real second provider.** The fixtures are two in-process
  providers on different `api` identifiers.

### This branch's own gates

`npm --workspace @allenyolk/pi-compaction run check` — typecheck clean, 65/65 pass (45 before this
change). `npm run check` — 151/151 pass. `npm pack --json --ignore-scripts` still produces exactly the
eight entries listed below.

## The packed artifact

`npm pack --json --ignore-scripts` in `packages/pi-compaction` produces exactly eight entries: the
five TypeScript sources under `src/`, `README.md`, `LICENSE` and `package.json`. No tests, no
`docs/`, no `tsconfig.json`, no `work/`, no `node_modules`.

The evaluation harness is deliberately outside it: `eval/` is not in `files`, so the fixture, the
scorers and the live mode are development tooling that no installed copy carries.

- `repository.directory` is `packages/pi-compaction`, so npm shows the right subdirectory.
- `exports` and `pi.extensions` both name `./src/index.ts`; Pi loads that TypeScript source directly,
  so no local build is required.
- No install lifecycle script ships, and the artifact declares no `dependencies` and no bundled Pi
  core; the host stays an unbundled `"*"` peer.
- The source reads no credentials, opens no socket and emits no telemetry. Its only imports are
  `node:fs`, `node:path` and `@earendil-works/pi-coding-agent`.

## Measured on the owner's machine

Everything here was re-derived from `~/.pi/agent/sessions`, read-only, with the host's own
`estimateTokens`, `sessionEntryToContextMessages` and `buildSessionProjection` from
`@earendil-works/pi-coding-agent` — 1.5.1 and 1.5.2, whose `compaction.js` and `session-manager.js`
are byte-identical. The session it reads was still running, so the audit is bounded rather than
open-ended: it covers every `compaction` entry with a timestamp at or before
**2026-11-16T07:57:45.573Z**, which is where the store stood when the audit ran and is a boundary
anyone can re-derive against. Later compactions in that session exist and are not counted. The
configuration in force was `minimax-cn/MiniMax-M3.1-Flash` at `thinking: "low"` with a 16,000-token
kept window.

**What the store holds.** 22 `compaction` entries at or before that instant, across the 70 session
files the store held, of which **16 are distinct**: a resumed session is copied into a second file, so
six of them appear twice. De-duplicated on `(timestamp, tokensBefore, summary length)`, **10 went
through this package's hook** and **6 are stock Pi**.

**How each column is measured.** The token columns are what the next request carries: `summary` is
the `compactionSummary` message of the entry, `kept` is every entry from `firstKeptEntryId` up to the
compaction, and `summary + kept` is the two together — the projection after the compaction, minus the
system message. Adding the prompt-and-tools constant to it gives the base context CONTEXT.md defines;
that constant is reported separately below because it differs between the two groups. Every figure in
the table is a **median**; the ranges are in the bullets. `wall` is inferred from the timestamp of the
last `message` entry before the compaction, not from the entry immediately before it: in six of the
nine that entry is a `goal-state` custom entry, and in the tenth it is a `session_info` written 175 s
after the last message, which would have reported 63.5 s instead of 238.4 s. `output`, `reasoning`
and `cost` are recorded on the entry, not inferred.

| Group | n | summary | kept | summary + kept | wall | output | reasoning | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| This package, `MiniMax-M3.1-Flash` + `low`, ordinals 2–4 of one `mafia-o/gpt-6-astra` chain | 3 | 4,955 | 15,321 | 20,791 | 36.5 s | 6,281 | 111–193 | $0.011 |
| Stock Pi — the six stock compactions in the store | 6 | 1,533 | 18,280 | 19,741 | 84.4 s | 4,224 | 352–5,627 | $0.133 |

**The second row is not a baseline for the first.** Those six are a different population: four on
2026-11-05 with `mafia-o/gpt-6.1-sol` and two on 2026-11-09 with `mafia-o/gpt-6-astra`, all of them
subagent sessions at ordinals 1–2, four of the six written under an older summarization prompt that
does not produce the nine sections, and all six carrying a 12,203-token prompt-and-tools constant
against 20,365–24,138 in the chain above. The rows differ in conversation model, date, session kind,
ordinal and host prompt, so read the table as what one machine recorded, not as an A/B. What it does
support is the absolute figure: nine compactions on a model chosen for the job, each finished in
34.2–120.7 s for $0.0099–$0.0146. The price difference between the rows is the price of the two models
on one gateway, not a property of this package.

- **10 compactions through the hook, 0 degradation entries, 0 handbacks.** No
  `pi-compaction-degradation` custom entry exists anywhere in the store, and every compaction recorded
  while the package was enabled carries `fromHook: true`.
- **Kept window 9,639–16,969 against the 16,000 cap.** The 9,639 outlier is a cut point whose
  preceding entry is a single 10,069-token message: the target is a cap, not a goal.
- **Stock Pi's kept window spans 13,019–27,920** against its 20,000 setting — visibly less stable.
- **File lists 20–37 read and 2–9 modified, against the per-list cap of 40.** The cap has never been
  reached.
- **Summary growth +538 tokens per compaction** for this package — the mean step over the
  nine-compactions chain, whose median step is +525 — against +2,148 and +1,647 for the one step each
  of the two stock chains that has a second compaction. One step in the hook chain **shrank by 767**
  tokens.
- **10/10 summaries carried all nine sections, ended with a populated `## Critical Context`, and
  named zero paths the summarised range does not support.** A path counted as supported when the
  range or the previous summary contains it, any suffix of it, or both its parent directory and its
  basename.
- The whole chain, rather than the ordinal band: wall 34.2–120.7 s (median 41.8), cost
  $0.0099–$0.0146 and $0.114 for all nine, output 4,387–11,097 tokens, reasoning 56–291, input
  47,046–66,807, summary 3,274–7,581. The tenth hook compaction is a second session
  (`mafia-o/gpt-6-sol`, ordinal 1): 238.4 s, $0.0099, 16,138 kept.

**What these numbers are not.** One machine, one workload (`daodao`), and a small n. Wall time is
inferred from entry timestamps rather than recorded, and cost is the host's own accounting against a
proxy's pricing rather than an invoice.
[#29](https://github.com/AllenYolk/pi-extensions/issues/29) is the reproducible version.

**What could not be re-derived.** The stock baseline
[#32](https://github.com/AllenYolk/pi-extensions/issues/32) records — six `mafia-o/gpt-6-astra`
compactions at ordinals 2–4, 211 s, $1.42, 12,812 output tokens, a 7,426-token summary — is not in
the store: no stock compaction here is at ordinal 3 or 4, and none falls after 2026-11-09. The same
applies to its count of thirteen hook compactions and its kept-window maximum of 20,581. Main session
files do go missing from this store — the `daodao` t3-worktree session directories are present but
empty, and the 2026-11-03/05/08 `daodao` directories retain only their `tasks/` subagent sessions —
so those figures are recorded as the owner's, not as re-derived here. Everything above is the
re-derived set.

## Reproducing a comparison: the evaluation harness

The re-derived figures are in [Measured on the owner's machine](#measured-on-the-owners-machine), and
that section is explicit about what they are not: a controlled comparison. The two groups in it differ
in conversation model, date, session kind, ordinal and host prompt, so no row there measures one
summarizer against another on the same input. [The evaluation harness](../eval/README.md) is that
measurement — one fixed input, several summarizer configurations, one scorer.

Both confounders are fixed by construction rather than by care:

- **The conversation model** is an arm, not a variable. Every arm is an explicit `{model, thinking}`
  tuple given on the command line.
- **The compaction ordinal** is pinned. One session, one previous summary and one cut point, so every
  arm runs the host's update prompt over exactly the same range at the same ordinal — which is what
  the ad-hoc numbers this package was built on had to control for by hand.

Scoring is deterministic and involves no model, because a model grading a model's summary is not
reproducible and cannot gate anything. Each arm is scored on how many of the nine sections the host's
prompt asks for it carries, how many file paths it names that the summarised range does not contain,
how many of the fixture's declared probes survived, and its output tokens against the control arm.
Wall time, output and reasoning tokens, cost and stop reason are recorded beside them, and an arm
whose every summarization response did not stop with `stop` fails the run. A split turn makes two
summarization requests that the host concatenates into one summary, so both of its response groups are
recorded and both are checked — a clean second group says nothing about a partial first one, which is
the same rule the hook in `src/index.ts` applies before it persists anything.

```sh
node eval/harness.ts --score summary.md                   # offline: no credentials, no request
node eval/harness.ts --arm 'provider/model@low' --arm ... # live: costs money, never in CI
```

The live mode is the only part that opens a socket, and it is unreachable without `--arm`. Its fixture
is **synthetic** — a fictional session, never the owner's — and far smaller than the workload the
section above reports on, so a run reproduces the shape of a comparison rather than those figures. A
real session is read at run time from a path the operator passes (`--session`) and is never committed.

**No arm of the live mode has been run in this repository.** Its recording has been exercised against
a fake in-process provider; the scorers and the whole of `--score` are unit-tested and make no
request. Every figure in this document is either what the store audit re-derived or what the owner
recorded.

## Known limits

These are properties of the design, documented in the package README, not defects to fix here:

- **The summary is not bounded.** The host sends no `max_output_tokens` and neither does this package.
  On the profile this package was built against that meant 26,019 tokens by the sixteenth compaction
  and a base context of 93,152 — unchanged by this package. Growth per cycle, and therefore how much
  work a session absorbs between compactions, is not something it improves.
- **A handback gives up the model and the thinking level, and nothing else.** It does not change the
  summary's length, because neither path sends a ceiling.
- **A model that cannot be told not to reason cannot be told not to reason.** A zero-cost `thinking:
  "off"` is clamped to the model's lowest supported level on a model whose `thinkingLevelMap` marks
  `off` unsupported, and the model reasons anyway. The status view reports the level that ran, not the
  level that was asked for. The owner's own conversation model is such a model.
- **Three `shortcut:` comments in the source carry their own upgrade conditions**, and none of the
  three conditions has been met:
  - `prepareCompaction` measures raw entries, so a pruned result would count at full size — moot now
    that nothing is pruned, but the raw-versus-projected cut point remains. **Still accurate**: this
    package calls the exported `findCutPoint()` on raw source entries while the host's own
    preparation measures projected messages through a module-private `findProjectedCutPoint()`, which
    neither 1.5.1 nor 1.5.2 exports, so correcting it still means reimplementing that search.
    Measured: the nine-compactions chain carries **no `context_edit` entry at all** (97 exist
    elsewhere in the store), and its raw and projected kept windows are identical for all nine — a
    divergence of **0 tokens**.
  - `curateFileOps` keeps the file operations the host extracted, which cover the host's summarised
    range rather than this package's, so paths touched only between the host's cut point and its own
    are not listed — extract them from this package's own range when a summary's file index proves
    too thin. Measured: read lists of **20–37** and modified lists of **2–9** against the per-list cap
    of 40, and 10/10 summaries named zero paths the summarised range does not support, so the index
    has never proved too thin.
  - `hostRetryPolicy` repeats `SettingsManager.getRetrySettings()`'s four defaults, without which the
    host's own `retryAssistantCall()` wrapper never retries at all — read the resolved policy from
    the extension API when the host exposes one. **Still accurate on 1.5.1 and 1.5.2**:
    `getRetrySettings()` returns the same four values this package replicates (`true`, `3`, `2_000`,
    `60_000`), the host still wraps summarization in `retryAssistantCall()`, and `ExtensionAPI`
    exposes no resolved retry policy — `getSettings()` hands back a clone of the deep-merged global
    and project settings, which is the merged-not-resolved object the comment describes.
- **The degradation record is not rendered in the transcript.** Drawing it would mean registering a
  TUI component and adding an `@earendil-works/pi-tui` peer dependency, which this package
  deliberately does not have. The pinned widget carries the visible announcement and `/compaction`
  reports the durable record.
- **No project-level configuration overrides**, by design.

## Rollback

The package never patches the host, never edits an installed Pi or `node_modules`, and never changes
the host's compaction settings, so rollback is a configuration change rather than a repair.

Per session or per user, in increasing order of thoroughness:

1. `/compaction disable` — writes `enabled: false`. Compaction returns to stock Pi at the next
   compaction, which means the conversation model and the session's thinking level.
2. `/compaction model conversation` — keeps the package enabled but summarises with the conversation
   model, which is what stock Pi does.
3. Delete `extensions/pi-compaction/config.json` from the Pi agent directory. A missing file loads the
   defaults, which are inert, so this is equivalent to (1) without leaving a file behind.
4. `pi remove npm:@allenyolk/pi-compaction`, or remove the collection declaration and restart.

What rollback does **not** undo: nothing. Unlike earlier versions this package writes no `context_edit`
entries and no session mutations beyond the degradation record, which is a custom entry carrying no
LLM context.

For a published version: npm registry tarballs are immutable, so a fix needs a new version even if the
bad one is unpublished. Stopping new installs of a bad version (`npm deprecate`) and any unpublish
decision are the owner's account actions, per docs/publishing.md.

Because the package is inert until enabled, a bad release cannot take over anyone's compaction.

## Independent review

Two rounds happened, and both changed the package.

### The release review

An independent two-axis review — Standards and Spec — ran against the first release candidate on
`main` at `3238649`. It raised four release-blocking findings, all resolved before the first release: a third
host seam that was load-bearing and unchecked (the host awaits `result()` on what the stream function
returns); a partial-summary guard that no test reached and that treated an unobserved attempt as a
clean one; five terms missing from CONTEXT.md; and an undercount of the `shortcut:` comments in this
document.

### The algorithm audit

After the version PR, four independent audits of the algorithm ran in parallel on four different
models, each with the same brief and a different emphasis: arithmetic, architecture,
adversarial failure modes, and the owner's own usage scenario. All were read-only and none could see
the owner's `models.json` or real session.

Three findings were confirmed by all four and are fixed:

- **The acceptance test and the request disagreed.** A single-pool request asks for text budget plus
  reasoning budget as one envelope while the test accepted only the text budget, leaving a dead band
  8,000 tokens wide on `balanced` and 24,000 on `deep`. `deep` was strictly worse than `balanced` for
  it. (Moot now that there is no ceiling, but it was real then.)
- **A split turn was read through its last response only.** The host makes two summarization requests
  through the same stream function and concatenates both, so a clean second response said nothing
  about a partial first one — and a partial history response could be persisted. One audit reproduced
  it in memory. **Still fixed, and still the package's core guarantee.**
- **`balanced` was the wrong default on the owner's model**, because the reasoning budget does not
  reach a single-pool provider at all.

Four more, each confirmed against the host source:

- The tighter ladder rung handed the host an unsupported `off`, leaving the adapter to its own default
  effort — possibly higher than the first attempt's.
- The host's file-list block was counted against the model's budget.
- The host's retry policy was never passed, silently disabling the host's own `retryAssistantCall()`
  wrapper.
- A cut point that leaves nothing to summarise handed back silently, contradicting the package's own
  statement that degradation is never silent.

And one about honesty: a model can switch its own output ceiling off through
`compat.supportsMaxOutputTokens`, and the status view still reported a ceiling. That flag is now read.
**It is moot in the shipped design**, which sends no ceiling to switch off.

One audit finding was **wrong** and is recorded so it is not re-derived: one auditor reported that
`openai-responses` probably never sends `max_output_tokens` at all, reading the adapter's default as
`?? false`. It is `?? true`, and the second gate applies only to a ChatGPT sign-in against
`api.openai.com`. The mechanism it found is real; the severity was not.

### The automated review

OpenCodeReview ran on the release PR and found nine issues. Six were real, and two of those were
introduced by this branch's own changes — both in the same way, by adding a value to a call without
extending what verifies it:

- **A retried response could fail the attempt.** Passing the host's retry policy means the stream
  function can be called more than once for one summarization request, and only the response the host
  finally returns is the one `compact()` acted on. The completeness check read the discarded failure
  and handed compaction back to stock Pi after a summary that had succeeded. Responses are now grouped
  by the context they came from — one group per summarization request, a later response replacing an
  earlier one in its group — so a retried-away failure is not the outcome, while a split turn's two
  ranges stay separate and both are checked.
- **The seam probe did not cover the tenth argument.** Arity proves the *count* of `compact()`'s
  parameters and nothing about their order, and every argument this package passed after the stream
  function used to be `undefined`, so a reorder was harmless. The retry policy is the first value where
  a wrong slot would silently misroute something the package depends on. The probe now fails its first
  attempt retryably and requires a second call, so a host that ignores or reorders that slot is
  detected instead of trusted.

The other four:

- **`describeFailure` could print `"undefined"` and drop the real error.** `stopReason` is optional, so
  a response with none — or one this package does not model — produced `stopped with "undefined"`, and
  in the catch branch the thrown error, the only real diagnostic, was discarded. There is now a
  distinct sentence for a response carrying no stop reason, and the error is quoted when there is one.
- **Provider-originated error text reached the terminal unsanitised.** The announcement is printed and
  pinned as a widget, so control characters in a provider's message could rewrite the display and a
  newline could break the one-fact-per-line shape. Quoted text is now stripped of control characters,
  whitespace-collapsed and length-bounded.
- **The split-turn test was vacuous.** Its filter could not match half of what it claimed and its
  assertion was trivially satisfiable, so it did not prove the guarantee it was named for. It now pins
  the request count and the stop reason of each of the three requests in order.
- **The acceptance test no longer checked the kept window.** The assertion was dropped along with the
  output ceiling, which left the cut point — one of the three things this package still controls, and
  the only one with a number attached — described but unverified. It is asserted again, against both
  this package's target and the host's 20,000-token default.

Two findings were about the announcement and one about dead code: it claimed the model and the thinking
level were "the whole of what this package controls" when the cut point is the third, its guidance
listed five of the seven thinking levels the command accepts, and a helper that could no longer
distinguish this package's request from the host's was left in the suite. All three are fixed.

One finding was checked and **does not hold as stated**: a test for the split-turn record ordering does
not turn red when weakened, because those assertions verify the test's *premise* — that a split turn
happened and that its first response was the partial one — rather than the package's behaviour. They
are kept for that reason, and the behavioural claim is verified separately: removing the completeness
check, or reducing it to the last response only, each turns the test red.

Every fix here is mutation-checked in the direction that matters, and two coverage gaps the mutations
exposed were closed rather than argued away: a response carrying no stop reason now has its own
real-CLI test, and the retry-policy defaults are asserted against the host's own source instead of
against constants the test invented.

### What the audits led to

The owner's requirement, stated after seeing the audit results: **the summary must not be truncated
or damaged**, and a weaker summarizer is acceptable. Every mechanism that could shorten a summary
violates that, so the output ceiling, the retry ladder, the prune path and the acceptance of a length
stop were all removed. [ADR 0005](adr/0005-bound-by-not-bounding.md) records the decision; ADR 0002,
0003 and 0004 are marked superseded.

What is left is what the owner asked for: pick the summarizer model, pick its thinking level, and never
persist a summary that is not whole.

The audits' open findings — no controlled latency or cost comparison, no real outbound request body,
no real-session replay — are unchanged and listed below. The owner's own machine has since recorded
latency and cost for ten compactions; see [Measured on the owner's machine](#measured-on-the-owners-machine).

## Not established

The honest gap list. None of these is claimed anywhere in the README or the changeset; where something
is now partly measured, the entry says what that establishes and what it does not.

- **Latency is measured on one machine, and not controlled.** The package's whole value is speed.
  [Measured on the owner's machine](#measured-on-the-owners-machine) records nine compactions in one
  chain at 34.2–120.7 s (median 41.8 s) against six stock compactions at 52.5–202.3 s (median 84.4 s),
  so the construction argument — a cheaper model with less thinking produces the same summary faster —
  now has real compactions behind it. It is still not a comparison: the two groups differ in
  conversation model, date, session kind, ordinal and host prompt, the wall time is inferred from
  entry timestamps, and nothing here runs both summarizers over the same input. The specification's
  289–490 s baseline remains the owner's measurement against the conversation model.
  [#29](https://github.com/AllenYolk/pi-extensions/issues/29) is the reproducible version.
- **No summary-quality comparison.** A weaker summarizer was accepted on the owner's judgement that
  it is fine. What is now known is narrower and structural: 10/10 summaries carried all nine
  sections, ended with a populated `## Critical Context`, and named zero paths the summarised range
  does not support. No side-by-side comparison of a summary produced by the conversation model
  against one produced by a cheaper model **on the same input** has been run, so how much detail a
  cheaper summarizer drops is still unknown.
- **No real-session replay.** The owner's 2,475-entry session is named in the spec as a one-time
  source of measured evidence. Real sessions have since been read, read-only, for the aggregate
  figures above; replaying one — re-running a compaction over a stored session — has not been done,
  and no session content beyond those aggregates is recorded here.
- **Linux is unverified locally.** Everything above is macOS arm64. `.github/workflows/check.yml` runs
  ubuntu-latest and macos-latest, but no run of this branch has been observed. Windows is not tested
  at all, by this candidate or by CI.
- **No Node 22 run locally.** CI covers it; this machine ran Node 24.18.0 only.
- **The published figures are the owner's, not re-measured here.** The 26,019-token summary, the
  93,152-token base context and the 34,874-token prompt-and-tools constant all come from issue #11's
  measurements.
- **`mafia-o`'s own model entry has been read** (with the owner's authorization, and only the fields
  below — no credentials). `api` is `openai-responses`, so the class is single pool. `compat`
  declares no `supportsMaxOutputTokens`, so the adapter's `?? true` default applies. And
  `thinkingLevelMap` differs per model: the owner's conversation model marks **both `off` and
  `minimal` unsupported**, while a sibling on the same provider declares `"off": "none"`. That is a
  per-model property, not a property of the gateway, and it is why the status view reports the level
  that ran.
- **The owner must still bind the package to npm trusted publishing**, and apply the changeset in a
  reviewed version PR, before anything can publish. See docs/publishing.md.
