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
| `npm --workspace @allenyolk/pi-compaction run check` | typecheck clean; **45/45 tests pass** |
| `npm run check` | **131/131 tests pass** (45 compaction on Pi 1.5.1, 16 delete, 52 display, 18 repository on Pi 0.99.1) |
| `npm run benchmark` | **deliberately skipped** — the presentation benchmark is for `@allenyolk/pi-minimal-display`; this package registers no TUI component and patches nothing. CI runs it on every push regardless. |

Which host proves what matters here. The package's own checks resolve Pi 1.5.1 from
`packages/pi-compaction/node_modules`, so every compaction assertion — including the real
packaged-CLI runs — is against 1.5.1. The repository-root checks resolve the root host, 0.99.1, and
exercise the package at the seams a collection user meets: it installs from its own packed tarball,
activates, deactivates on removal, stays inert when present and not enabled, coexists with the other
two extensions across repeated reloads, and installs from the git collection with and without a
resource filter. Compaction behaviour itself is **not** exercised on 0.99.1.

## The packed artifact

`npm pack --json --ignore-scripts` in `packages/pi-compaction` produces exactly eight entries: the
five TypeScript sources under `src/`, `README.md`, `LICENSE` and `package.json`. No tests, no
`docs/`, no `tsconfig.json`, no `work/`, no `node_modules`.

- `repository.directory` is `packages/pi-compaction`, so npm shows the right subdirectory.
- `exports` and `pi.extensions` both name `./src/index.ts`; Pi loads that TypeScript source directly,
  so no local build is required.
- No install lifecycle script ships, and the artifact declares no `dependencies` and no bundled Pi
  core; the host stays an unbundled `"*"` peer.
- The source reads no credentials, opens no socket and emits no telemetry. Its only imports are
  `node:fs`, `node:path` and `@earendil-works/pi-coding-agent`.

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
- **Three `shortcut:` comments in the source carry their own upgrade conditions**:
  `prepareCompaction` measures raw entries, so a pruned result would count at full size — moot now
  that nothing is pruned, but the raw-versus-projected cut point remains; `curateFileOps` keeps the
  file operations the host extracted, which cover the host's summarised range rather than this
  package's, so paths touched only between the host's cut point and its own are not listed — extract
  them from this package's own range when a summary's file index proves too thin; and
  `hostRetryPolicy` repeats `SettingsManager.getRetrySettings()`'s four defaults, without which the
  host's own `retryAssistantCall()` wrapper never retries at all — read the resolved policy from the
  extension API when the host exposes one.
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

The audits' open findings — no latency or cost measurement, no real outbound request body, no
real-session replay — are unchanged and listed below.

## Not established

The honest gap list. None of these is claimed anywhere in the README or the changeset.

- **No measured latency, and no latency claim.** The package's whole value is speed, and **nothing
  measures it.** The construction argument is that a cheaper model with less thinking produces the
  same summary faster; that argument has not been tested. The specification's 289–490 s baseline is the
  owner's measurement against the conversation model, not a comparison.
- **No summary-quality comparison.** A weaker summarizer was accepted on the owner's judgement that it
  is fine. No side-by-side comparison of a summary produced by the conversation model against one
  produced by a cheaper model has been run, so how much detail a cheaper summarizer drops is unknown.
- **No real-session replay.** The owner's 2,475-entry session is named in the spec as a one-time source
  of measured evidence. It was not read.
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
