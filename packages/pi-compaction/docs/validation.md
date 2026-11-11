# Validation

Release evidence for `@allenyolk/pi-compaction`, the candidate for its first release, `0.1.0`. This
records what is established today and, just as importantly, what is not. It is the release record
CONTRIBUTING.md's release checklist asks for; it is not a second status ledger.

The spec is [issue #11](https://github.com/AllenYolk/pi-extensions/issues/11). Nothing here has been
published: the changeset in `.changeset/` is release intent only, and publication requires the
owner's explicit authorization.

## Tested platforms and versions

Everything below was run on this machine for the release-gate ticket, on the `feat/pi-compaction-release`
branch cut from `feat/pi-compaction-ladder`, re-run on `fix/pi-compaction-review` for the review
findings, and re-run again on `fix/pi-compaction-audit` for the algorithm audit. The counts in the
table are that last run's; the environment is the same machine and the same host versions.

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
| `npm --workspace @allenyolk/pi-compaction run check` | typecheck clean; **85/85 tests pass** |
| `npm run check` | **171/171 tests pass** (85 compaction on Pi 1.5.1, 16 delete, 52 display, 18 repository on Pi 0.99.1) |
| `npm pack --json --ignore-scripts` | 9 entries: `LICENSE`, `README.md`, `package.json`, `src/{config,degradation,index,preparation,prune,summarizer}.ts` |
| `npm run benchmark` | **deliberately skipped** — see below |

The root suite needed one repository change to stay green with this branch's unapplied changeset.
`test/publish-gate.test.mjs` asserted that the publish workflow's "Require applied version changes"
step passes on the working tree, which couples it to the branch's release state: docs/publishing.md's
flow keeps a changeset pending until a separate version PR, and the gate exists precisely to reject
that at publication time. The assertion now removes the repository's own pending changesets from the
scratch clone the test already creates, so the step's real shell runs verbatim against a controlled
tree and the synthetic pending changeset still proves it rejects one. Both directions were
mutation-checked: a gate that never rejects and a gate that always rejects each turn the test red.
This has bitten before — PR #15's first CI run failed the same way — so it is a repository fix, not a
compaction-package one.

Which host proves what matters here. The package's own checks resolve Pi 1.5.1 from
`packages/pi-compaction/node_modules`, so every compaction, prune and degradation assertion —
including the real packaged-CLI runs — is against 1.5.1. The repository-root checks resolve the root
host, 0.99.1, and they exercise the package at the seams a collection user meets: it installs from
its own packed tarball, activates, deactivates on removal, stays inert when it is present and not
enabled, coexists with the other two extensions across repeated reloads, and installs from the git
collection with and without a resource filter. Compaction behaviour itself is **not** exercised on
0.99.1.

`npm run benchmark` is the presentation benchmark for `@allenyolk/pi-minimal-display`. This candidate
changes no presentation code — it adds no tools, registers no TUI component and patches nothing — so
it was checked and skipped rather than silently omitted. CI runs it on every push regardless.

## The packed artifact

`npm pack --json --ignore-scripts` in `packages/pi-compaction` produces exactly nine entries: the
six TypeScript sources under `src/`, `README.md`, `LICENSE` and `package.json`. No tests, no
`docs/`, no `tsconfig.json`, no `work/`, no `node_modules`.

- `repository.directory` is `packages/pi-compaction`, so npm shows the right subdirectory.
- `exports` and `pi.extensions` both name `./src/index.ts`; Pi loads that TypeScript source directly,
  so no local build is required. The repository check proves it by packing, unpacking and installing
  the real artifact into a disposable profile.
- No `preinstall`, `install`, `postinstall`, `prepare` or `prepack` script ships, and the artifact
  declares no `dependencies` and no bundled Pi core; the host stays an unbundled `"*"` peer.
- The source reads no credentials, opens no socket and emits no telemetry. Its only imports are
  `node:fs`, `node:path` and `@earendil-works/pi-coding-agent`.

Two defects the inspection turned up were fixed in this ticket: the manifest declared a `sandbox`
script pointing at `test/make-sandbox.mjs`, which this package does not have (copied from
`pi-delete`), and the manifest version had to move to `0.0.0` for Changesets to produce `0.1.0` as the
first published version — see below.

## Version and release intent

The manifest carries `0.0.0` and `.changeset/pi-compaction-first-release.md` declares a **minor**
intent. Verified with Changesets 3.0.3 in a scratch copy of this tree: `0.0.0` + `minor` produces
`0.1.0` and a `CHANGELOG.md`; the previous `0.1.0` + `minor` produced `0.2.0`, which is not the first
release this package documents. The version PR is what turns the pending changeset into `0.1.0`, and
it is also what creates the `CHANGELOG.md` that `publish.yml` passes to `gh release create
--notes-file`.

## Known limits

These are properties of the design, documented in the package README, not defects to fix here:

- **No recall tool for pruned content.** Recovery is by re-running the tool, which is what makes the
  never-prune list a correctness requirement. The raw result is untouched on disk, but nothing in
  this package reads it back.
- **On a provider with prompt caching the measured prune gate does not fire.** Every request either
  reads the prefix back or writes the entry the next request would read, so pruning on such a session
  runs at compaction imminence — roughly once per compaction cycle, not continuously.
- **On single-pool APIs the reasoning budget is advisory.** `openai-responses` and
  `azure-openai-responses` never read `thinkingBudgets`, so reasoning draws uncapped from the same
  pool and the text has no independent ceiling. `openai-completions` honours it only when the model's
  compatibility settings declare a thinking-token-budget field.
- **`openai-codex-responses` sends no output-ceiling field at all**, so a summarizer on it degrades
  before any request rather than claiming a bound it does not have.
- **The Google adapters' envelope is provider-dependent and untested**: `thinkingConfig.thinkingBudget`
  is separate from `generationConfig.maxOutputTokens`, and whether the provider counts thinking
  against `maxOutputTokens` was not verified.
- **Any API not enumerated is treated as a single pool.** `mistral-conversations` and `pi-messages`
  were checked in pi-ai 1.5.1 for this ticket and both send an output ceiling derived from `maxTokens`
  while ignoring `thinkingBudgets`, so the default is right for them. The classification APIs
  (`llama-cpp-classify`, `openai-decisions`, the System One family) and `openrouter-images` cannot
  produce a summary at all.
- **The degradation record is not rendered in the transcript.** Drawing it would mean registering a
  TUI component and adding an `@earendil-works/pi-tui` peer dependency, which this package
  deliberately does not have. The pinned widget carries the visible announcement and `/compaction`
  reports the durable record.
- **Six `shortcut:` comments in the source carry their own upgrade conditions**: `describeOutboundRequest`
  repeats the adapters' arithmetic instead of reading a projection pi-ai does not expose;
  `prepareCompaction` measures raw entries, so a pruned result counts at full size and the kept window
  lands smaller than its target; `hostCompactionTrigger` repeats the host's `reserveTokens`
  resolution because an extension is handed merged rather than resolved settings; `curateFileOps`
  keeps the file operations the host extracted, which cover the host's summarised range rather than
  this package's, so paths touched only between the host's cut point and its own are not listed —
  extract them from this package's own range when a summary's file index proves too thin;
  `fileListChars` repeats the host's `computeFileLists()`/`formatFileOperations()` pair to measure the
  block it appends after the model's text, because `compact()` returns the summary as one string —
  measure the blocks from the compaction result when the host returns them separately; and
  `hostRetryPolicy` repeats `SettingsManager.getRetrySettings()`'s four defaults, without which the
  host's own `retryAssistantCall()` wrapper never retries at all — read the resolved policy from the
  extension API when the host exposes one.
- **No project-level configuration overrides**, by design.

## Rollback

The package never patches the host, never edits an installed Pi or `node_modules`, and never changes
the host's compaction settings, so rollback is a configuration change rather than a repair.

Per session or per user, in increasing order of thoroughness:

1. `/compaction disable` — writes `enabled: false`. Compaction returns to stock Pi at the next
   compaction; pruning stops at the next turn boundary.
2. `/compaction preset off` — keeps the package enabled but returns compaction to stock Pi.
   `"preset": "off"` in the file does the same.
3. Delete `extensions/pi-compaction/config.json` from the Pi agent directory. A missing file loads
   the defaults, which are inert, so this is equivalent to (1) without leaving a file behind.
4. `pi remove npm:@allenyolk/pi-compaction`, or remove the collection declaration and restart.

What rollback does **not** undo: `context_edit` entries already written to a session stay in that
session's projection, so results already pruned in that session stay pruned. The raw entries are
still on disk, and the originating tool calls are still present, so nothing is lost — a re-run
recovers the content. The `pi-compaction-degradation` custom entries are records and carry no model
context.

For a published version: npm registry tarballs are immutable, so a fix needs a new version even if
the bad one is unpublished. Stopping new installs of a bad version (`npm deprecate`) and any
unpublish decision are the owner's account actions, per docs/publishing.md.

Because the package is inert until enabled, a bad release cannot take over anyone's compaction: a
collection user who never enabled it is unaffected by any future version.

## Independent review

**Done, and its release-blocking findings are resolved.** An independent two-axis review — Standards
and Spec — was run against the package on `main` at `3238649`. It raised four release-blocking
findings, all resolved on `fix/pi-compaction-review`:

- A **third host seam** was load-bearing and unchecked: the host awaits `result()` on whatever the
  stream function returns, which is how the package reads a response's stop reason. The activation
  check now rejects a host that does not, and ADR 0001, the README and this document name three
  seams rather than two.
- The **partial-summary guard** was reached by no test and treated an attempt whose response was
  never observed as a clean one. A real packaged-CLI run now proves that a response stopping with
  `aborted` — which the host returns as a normal result carrying partial text — is refused and never
  persisted, and the guard no longer persists an unobserved attempt.
- Five terms the package introduced — prune window, API class, prune gate, rung and placeholder —
  were missing from CONTEXT.md and are now in its "Context compaction" section.
- This document **undercounted the `shortcut:` comments**; there are four, not three.

The review also recorded findings the owner chose to ship rather than fix: a repeated-switches
judgement call between `apiClassOf` and `describeOutboundRequest`, `test/run-prune.mjs` duplicating
`test/run-compaction.mjs`, two data clumps in `src/index.ts`, the
`HOST_PROMPT_AND_TOOLS_TOKENS = 34_874` constant being one profile's measurement, and
`DEGRADATION_ENTRY` / `DEGRADATION_WIDGET` holding the same string. None of them blocks the four
fixes above.

The automated OpenCodeReview workflow runs when a pull request first opens; its findings, and the
owner's own review, are the other half.

### The algorithm audit

After `0.1.0` was published, four independent audits of the algorithm ran against it in parallel, on
four different models (`mafia-o/gpt-6.1-sol`, `mafia-a/claude-opus-5-5`, `mafia-o/grok-4.7`,
`minimax-cn/MiniMax-M3.1-Flash`), each with the same brief and a different emphasis: arithmetic,
architecture, adversarial failure modes, and the owner's own usage scenario. All four were read-only
and none could see the owner's `models.json` or real session.

Three findings were confirmed by all four, and each is now fixed and regression-tested:

- **The acceptance test and the request disagreed.** A single-pool request asks for text budget plus
  reasoning budget as one envelope, while the acceptance test accepted only the text budget. That left
  a dead band — 8,000 tokens on `balanced`, 24,000 on `deep` — in which a summary the provider was
  allowed to write was refused anyway, costing a second full summary request every time a model landed
  in it. `deep` was strictly worse than `balanced` for it: the same acceptance bound with three times
  the room to overshoot into. An attempt now accepts whatever its own request bounds.
- **A split turn was read through its last response only.** The host makes two summarization requests
  through the same stream function and concatenates both, so a clean second response said nothing
  about a partial first one. The `gpt-6.1-sol` audit reproduced it in memory: an `aborted` history
  response carrying partial text, a clean prefix response, and the existing guard accepting the
  concatenation. Every response an attempt produces is now checked.
- **A split turn with an empty history range could not be bounded at all.** The host carries the
  previous summary forward verbatim and appends a fresh turn prefix, so the result can only grow. That
  shape is now declined before any request, and announced.

Three further findings, each confirmed by reading the host source and each now fixed:

- **The tighter rung handed the host an unsupported `off`.** The host omits its reasoning option only
  for a level of exactly `off`, so on a model whose `thinkingLevelMap` marks `off` unsupported the
  retry left the adapter to its own default effort — which can be higher than the first attempt's, the
  opposite of the retry's purpose. The rung now asks for the lowest level the model has, and the
  announcement says which.
- **The host's file-list block was counted against the model's budget.** A summary that used exactly
  its budget was refused for text the model never wrote. The block is now excluded.
- **The host's retry policy was never passed.** `compact()`'s retry argument was `undefined`, and the
  host's `retryAssistantCall()` wrapper never retries without a policy — so a transient stream drop on
  a minutes-long summary request failed the whole compaction on the first attempt, strictly worse than
  the native path it wraps. The resolved policy is now passed.

Two more, both about honesty rather than behaviour:

- **A model can switch its own ceiling off.** `openai-responses` writes `max_output_tokens` only while
  `compat.supportsMaxOutputTokens` is not false. The flag defaults to on, but a model that switches it
  off drops the ceiling silently while this package's descriptor still reported one. The
  `gpt-6.1-sol` audit confirmed it by capturing an adapter payload. The flag is now read, and such a
  model is treated as sending no ceiling and named in the announcement.
- **A cut point that leaves nothing to summarise returned silently.** It handed compaction back
  without the announcement that every other handback makes, contradicting this package's own
  statement that degradation is never silent. It now goes through the same announcement.

One audit finding was **wrong** and is recorded so it is not re-derived: one auditor reported that
`openai-responses` probably never sends the ceiling at all, reading the adapter's default as
`?? false`. It is `?? true`, and the second gate applies only to a ChatGPT sign-in against
`api.openai.com`. The mechanism it found is real; the severity was not.

What the audits did **not** establish, and what remains open, is in "Not established" below: no
latency or cost measurement, no real outbound request body, and no real-session replay.

### The subtraction

After the audits, the owner restated the requirement: do not assume the summarizer can respond to
complex instructions. Three things in the design assumed it did, and all three are gone.

- **The retry ladder is removed.** Both rungs depended on compliance. The single-pool rung appended a
  written "keep the summary within N tokens" instruction, which is precisely the compliance the new
  requirement rules out. The answer-budget rung halved both budgets, which makes a length stop *more*
  likely — it was answering "the thinking phase ate the quota" with a smaller quota. Both cost a second
  full request, minutes on a real summary, for an outcome the ceiling had already decided. A
  compaction now makes **one** request.
- **A length stop is accepted.** This is the change that makes the one request sufficient, and it is
  recorded as [ADR 0004](adr/0004-accept-a-length-stop-as-the-budget-working.md) because it
  deliberately overrides a host decision: the host throws on a length stop so that an incomplete
  summary cannot become a checkpoint, which is right for a caller that sets no ceiling and wrong for
  one that does. The stream function this package owns reports the stop to the host as a normal stop
  and records the real reason for its own acceptance test. Truncated summaries are now persisted, and
  the test fixture distinguishes them (`TRUNCATED-AT-THE-CEILING`) from the partial text that must
  never be persisted (`PARTIAL-SUMMARY-MUST-NEVER-BE-PERSISTED`).
- **The acceptance bound is the pool on both API classes.** It was the text budget on answer-budget
  APIs, which left a dead band as wide as the reasoning budget. Whether the text has guaranteed room
  inside the pool is a separate question, reported by `textRoomGuaranteed`.

Considered and rejected, at the owner's direction: truncating an over-budget summary (it produces one
that reads as complete when it is not), and an index-shaped fallback summary when the model fails
entirely (the owner chose to keep handing back to stock Pi, so a model error still costs an unbounded
native compaction — unchanged, and now the only path that does).

What the owner asked for, and what remains: pick the summarizer model, pick its thinking level, and
bound the length. All three were already supported; what changed is that the bound now holds on the
path where the model does not cooperate.

### Reading the owner's own model entry

The audits could not see `~/.pi/agent/models.json`, so three of their conclusions about the owner's
provider were inferences. Reading it afterwards — with authorization, and only the fields below —
turned one of those inferences into a measurement and corrected another:

- `compat.supportsMaxOutputTokens` is unset, so the ceiling **does** reach the provider. One auditor
  had reported it probably never did.
- The owner's conversation model marks **both `off` and `minimal` unsupported**. Two auditors had
  derived this from the identically named built-in entry; it is now confirmed against the real
  configuration, and it is worse than the built-in entry alone suggested.
- A sibling model on the same provider declares `"off": "none"`. So this is a per-model property, not
  a property of the gateway, and a preset's value depends on which model it runs on.

That last point produced a further fix beyond the audit's findings: a zero reasoning budget does not
mean the summarizer will not reason, and the status view used to claim it did. There is now an
`uncapped` reasoning-budget effect, the announcement names the level the request actually used, and
`README.md` has a section on models that cannot be told not to reason.

## Not established

The honest gap list. None of these is claimed anywhere in the README or the changeset.

- **Per-model ceiling verification against real providers.** Issue #11 requires, for each model
  configured as a summarizer, one deliberately oversized request confirming a length stop is
  reported — explicitly "not optional", because a compatibility flag can switch an output ceiling off
  and it is then dropped silently. This needs a real model account and real requests. It has not been
  done, and the spec's own rule keeps real accounts out of CI, so it is a manual gate.
- **No measured latency.** The spec targets compaction wall time materially below the 289–490 s
  baseline, and says the number is only meaningful against a fixed replay workload. No such replay
  was run for this candidate, so there is **no latency evidence at all** — only the construction
  argument that a smaller summary is a smaller request.
- **No real-session replay.** The owner's 2,475-entry session is named in the spec as a one-time
  source of measured evidence. It was not read for this ticket.
- **The two-value ceiling has not been observed in a real outbound request body.** Every ceiling
  assertion observes the options where this package hands them to the host's stream function, through
  an in-process fake provider. Proving the intended body after the host's real adapter translates it
  needs the loopback endpoint the spec defers; that is a separate concern and not a blocker for
  anything else. This matters more than it did: an independent audit confirmed by capturing an
  adapter payload that a model declaring `compat.supportsMaxOutputTokens: false` receives **no**
  `max_output_tokens` while this package's own descriptor still reports a ceiling. The flag is now
  read and such a model is treated as sending no ceiling, but only a real request body proves what a
  given gateway does.
- **`mafia-o`'s own model entry has been read** (with the owner's authorization, and only the three
  fields below — no credentials). `api` is `openai-responses` at the provider level, so the class is
  single pool and the reasoning budget is advisory on every model there.
  `compat.supportsMaxOutputTokens` is **not** set at either level, so the adapter's `?? true` default
  applies and the output ceiling does reach the provider — the audit's worst fear for this provider is
  ruled out by configuration, not by argument. `thinkingLevelMap` differs per model and is the finding
  that mattered: the owner's own conversation model marks **both `off` and `minimal` unsupported**, so
  `fast` is clamped to `low` and reasons anyway, while a sibling model on the same provider declares
  `"off": "none"` and genuinely stops. That is now stated in the README, reflected by a new
  `uncapped` reasoning-budget effect, and covered by a real-CLI test.
- **On an answer-budget API with no `off`, the reported ceiling is a lower bound.** The adapter adds a
  thinking budget of its own when none is supplied, and what it picks is not readable from the model,
  so `describeOutboundRequest` cannot state the resulting envelope. The status view says so. This does
  not affect `mafia-o`, which is single pool.
- **Linux is unverified locally.** Everything above is macOS arm64. `.github/workflows/check.yml` runs
  ubuntu-latest and macos-latest on Node 22.19.0 and 24.12.0, but no run of this branch has been
  observed. Windows is not tested at all, by this candidate or by CI.
- **No Node 22 run locally.** CI covers it; this machine ran Node 24.18.0 only.
- **The published figures are the owner's, not re-measured here.** The 34,874-token prompt-and-tools
  constant, the 93,152-token measured base context, the 15,340-token kept window and the 239,232-token
  trigger all come from issue #11's measurements. No figure was re-measured for this ticket.
- **The growth-per-cycle gain is much smaller than the specification's table suggests, and the README
  now says so.** Issue #11 compares its 112,464-token baseline with the bounded figures, but that
  baseline was measured against an older 206,464-token trigger, before the reserved-token change.
  Against the same 93,152-token base context at today's 239,232-token trigger the baseline is
  146,080, so this package's real improvement is 183,018 / 169,018 / 153,018 against 146,080 —
  1.25× / 1.16× / 1.05×. Of the apparent gain in the specification's comparison, 33,616 tokens per
  cycle are the reserved-token change alone (32,768 tokens of trigger plus the 848-token difference
  between the issue's stated 112,464 and the 113,312 that 206,464 − 93,152 actually gives); only
  36,938 / 22,938 / 6,938 are this package. Most of the growth improvement belongs to the trigger
  move, not to the bounded summary.
- **CI host-drift is a warning, not a gate.** `check.yml`'s `upstream-version` job already enumerates
  `pi-compaction` and reports when a newer Pi than 1.5.1 exists. That surfaces drift; it does not
  certify a host.
- **The owner must still bind the package to npm trusted publishing**, and apply the changeset in a
  reviewed version PR, before anything can publish. See docs/publishing.md.
