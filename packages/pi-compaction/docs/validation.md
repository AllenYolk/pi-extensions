# Validation

Release evidence for `@allenyolk/pi-compaction`, the candidate for its first release, `0.1.0`. This
records what is established today and, just as importantly, what is not. It is the release record
CONTRIBUTING.md's release checklist asks for; it is not a second status ledger.

The spec is [issue #11](https://github.com/AllenYolk/pi-extensions/issues/11). Nothing here has been
published: the changeset in `.changeset/` is release intent only, and publication requires the
owner's explicit authorization.

## Tested platforms and versions

Everything below was run on this machine for the release-gate ticket, on the `feat/pi-compaction-release`
branch cut from `feat/pi-compaction-ladder`:

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
| `npm --workspace @allenyolk/pi-compaction run check` | typecheck clean; **77/77 tests pass** |
| `npm run check` | **163/163 tests pass** (77 compaction on Pi 1.5.1, 16 delete, 52 display, 18 repository on Pi 0.99.1) |
| `npm pack --json --ignore-scripts` | 9 entries: `LICENSE`, `README.md`, `package.json`, `src/{config,index,ladder,preparation,prune,summarizer}.ts` |
| `npm run benchmark` | **deliberately skipped** — see below |

Which host proves what matters here. The package's own checks resolve Pi 1.5.1 from
`packages/pi-compaction/node_modules`, so every compaction, prune, ladder and degradation assertion —
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
- **Three `shortcut:` comments in the source carry their own upgrade conditions**: `describeOutboundRequest`
  repeats the adapters' arithmetic instead of reading a projection pi-ai does not expose;
  `prepareCompaction` measures raw entries, so a pruned result counts at full size and the kept window
  lands smaller than its target; `hostCompactionTrigger` repeats the host's `reserveTokens`
  resolution because an extension is handed merged rather than resolved settings.
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

**Not established.** No independent Standards or Spec review of this package has happened. CONTRIBUTING.md
requires both before a candidate is marked ready, and neither can be produced by the agent that wrote
the code. This is the largest open gate.

The automated OpenCodeReview workflow runs when a pull request first opens; its findings, and the
owner's own review, are the other half.

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
  anything else.
- **Linux is unverified locally.** Everything above is macOS arm64. `.github/workflows/check.yml` runs
  ubuntu-latest and macos-latest on Node 22.19.0 and 24.12.0, but no run of this branch has been
  observed. Windows is not tested at all, by this candidate or by CI.
- **No Node 22 run locally.** CI covers it; this machine ran Node 24.18.0 only.
- **The published figures are the owner's, not re-measured here.** The 34,874-token prompt-and-tools
  constant, the 93,152-token measured base context, the 15,340-token kept window and the 239,232-token
  trigger all come from issue #11's measurements. The README's growth-per-cycle comparison mixed a
  baseline measured against an older 206,464-token trigger with figures derived from today's
  239,232-token trigger; the README now states the like-for-like baseline (146,080) alongside it. No
  figure was re-measured for this ticket.
- **CI host-drift is a warning, not a gate.** `check.yml`'s `upstream-version` job already enumerates
  `pi-compaction` and reports when a newer Pi than 1.5.1 exists. That surfaces drift; it does not
  certify a host.
- **The owner must still bind the package to npm trusted publishing**, and apply the changeset in a
  reviewed version PR, before anything can publish. See docs/publishing.md.
