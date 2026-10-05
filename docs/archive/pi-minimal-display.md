# Archived history: AllenYolk/pi-minimal-display

Captured from https://github.com/AllenYolk/pi-minimal-display before the repository was retired. Issue and pull-request
numbers below belong to that repository; `pi-minimal-display#N` references are rewritten from the
original bare `#N` form so they do not resolve against this repository. The commits
themselves live in this repository under `archive/pi-minimal-display/…` refs.

## Labels in use (14)

| Label | Description |
| --- | --- |
| `accessibility` | Barrier affecting people with disabilities |
| `bug` | Something isn't working |
| `documentation` | Improvements or additions to documentation |
| `duplicate` | This issue or pull request already exists |
| `enhancement` | New feature or request |
| `good first issue` | Good for newcomers |
| `help wanted` | Extra attention is needed |
| `invalid` | This doesn't seem right |
| `needs-info` | Reporter information required |
| `needs-triage` | Maintainer evaluation required |
| `question` | Further information is requested |
| `ready-for-agent` | Specified and ready for agent implementation |
| `ready-for-human` | Requires human implementation |
| `wontfix` | This will not be worked on |

## Releases (3)

### v0.1.0 — Pi Minimal Display v0.1.0

Published 2026-09-05T18:50:28Z; commit ref `main`.

First public GitHub release of Pi Minimal Display.

## Highlights

- Groups consecutive ordinary tool calls into compact, native-style count/status cards.
- Ctrl+O (or the configured Pi expansion shortcut) switches between minimal cards and full native tool details without inserting mode messages into the transcript.
- Preserves conversation order, native images and controls, errors, session/model data, and interactive tools.
- Uses Pi's native thinking visibility: visible thinking remains native; hidden thinking and its `Thinking...` placeholder disappear and no longer split adjacent tool groups.
- Starts in minimal mode automatically while `/reload` preserves the current global expansion state.

## Compatibility

Fully tested on Pi 0.85.0 and 0.85.1, macOS and Ubuntu, Node 22.19.0 and 24.12.0. Activation checks the actual presentation-method signatures rather than binding to the Pi version string; incompatible presentation changes fail safely to Pi's native display.

## Install

Follow the default branch and receive compatible Git updates:

```sh
pi install git:github.com/AllenYolk/pi-minimal-display
```

Or pin this release:

```sh
pi install git:github.com/AllenYolk/pi-minimal-display@v0.1.0
```

Remove using the same source passed to `pi install`, then restart Pi. See the README for configuration and recovery details.

### v0.1.1 — v0.1.1

Published 2026-09-07T07:07:06Z; commit ref `main`.

## What's changed

- Silences Pi's native `Thinking blocks: visible/hidden` status line when the thinking-visibility shortcut is toggled.
- Preserves native thinking state, persistence, repaint, unrelated status messages, and the existing silent tool-expansion behavior.
- Adds real-host regression coverage and compatibility fingerprints for Pi 0.85.0/0.85.1 SDK and bundled hosts.

## Install

```sh
pi install git:github.com/AllenYolk/pi-minimal-display@v0.1.1
npm install @allenyolk/pi-minimal-display@0.1.1
```

### v0.1.2 — v0.1.2

Published 2026-09-30T14:17:46Z; commit ref `main`.

## What's changed

- Accepts Pi 0.99.1. The plugin previously fell back to native display there with `Pi 0.99.1 presentation methods are incompatible`. It adds allowlisted presentation fingerprints for the Pi 0.99.1 SDK and bundled CLI. Runtime behavior and configuration are unchanged.
- Tested hosts: Pi 0.85.0, 0.85.1 and 0.99.1. CI re-verifies Pi 0.85.1 and 0.99.1 on Ubuntu/macOS with Node 22.19.0/24.12.0. Incompatible hosts still stay native and show a diagnostic.

## Install

```sh
pi install git:github.com/AllenYolk/pi-minimal-display@v0.1.2
npm install @allenyolk/pi-minimal-display@0.1.2
```

Details and evidence: pi-minimal-display#26, pi-minimal-display#27.

## Issues and pull requests (27)

### pi-minimal-display#1 — Spec: compact, expandable tool presentation with reversible Pi patches

Issue · closed · opened 2026-09-05T08:58:33Z by AllenYolk · closed 2026-09-05T18:48:19Z · labels: `enhancement`, `ready-for-agent`

## Goal

Release-quality compact presentation for Pi, owned by AllenYolk. Owner approved the engineering setup, spec corrections, and test interfaces on 2026-09-05. This issue is the authoritative contract; docs/spec-review.md records the rationale.

## Presentation contract

- Per owner trial feedback in pi-minimal-display#10, group count_only and lines calls only while consecutive within a user turn. Assistant text/thinking (including hidden thinking), native tools, user/skill messages and other transcript output split groups. Empty tool-call-only assistant placeholders do not. Preserve tool/narrative relative positions in both collapsed and expanded views. Count-only-only groups must still have a visible expandable header.
- Collapsed groups show tool counts and textual pending/failed/succeeded state. Failure remains visible while other calls are pending. Commands/results stay accessible on expansion using the configured Pi expand shortcut and mouse; cancellation surfaces through the host error state.
- Per owner feedback in pi-minimal-display#12, expanded groups delegate only to existing native tool components in transcript order, without a Retained data appendix or another raw-data UI. Expanded tool output must match native presentation. Preserve original arguments, result blocks, details and session/model data unchanged; native renderer omissions are accepted. Images, controls and errors remain native. Never claim to recover output Pi discarded.
- With grouping off, count_only shows one compact expandable count/status; lines shows a one-line command preview and bounded text preview. Native always uses the original presentation. Long and multiline bash arguments are shortened only in the collapsed UI, never in execution or expanded detail.
- Per owner-approved pi-minimal-display#14, ordinary tools default=count_only, including actual names readSeek_edit/readSeek_grep and future tools. Built-ins read/grep/find/ls=count_only; bash/edit/write=lines. Default native exclusions are ask_user_question, plan_mode_question, plan_mode_complete. Explicit user default/tools overrides win. No fuzzy tool-name or interactive-tool classification.
- Config: grouping (default true), default (count_only), tools (mode overrides), bash.maxCommandChars (120), bash.outputLines (0). Missing file uses documented defaults. Invalid JSON/root/keys/types produces a visible diagnostic and complete native fallback. Respect getAgentDir()/PI_CODING_AGENT_DIR. Read config once per session startup/reload. A legacy boolean hideThinking key may be accepted and ignored during migration; it is not a display control.

- Per pi-minimal-display#14, summaries are native-themed cards: preceding one-line gap, one-column horizontal/one-row vertical padding, bold tool count line and status/shortcut line. Failure background wins over pending then success. Colored padding is clickable; the preceding gap is not. Read the current theme at render time and release the UI reference on disposal.
- Per owner choice pi-minimal-display#16, native global expansion is silent: keep the certified native setter/state/repaint, but suppress only its exact synchronous `Tool output: expanded/collapsed` status call. Preserve all other status and matching transcript content. Do not globally filter strings, write mode changes into the transcript, integrate Starship, add timers/widgets, intercept shortcuts, or copy the native expansion algorithm. Restore temporary status routing on every path and apply the same ownership/fingerprint/disposal rules to the setter wrapper.
- Minimal is automatic before first meaningful transcript paint. On successful startup/new/resume/fork activation use the public native expansion setter to collapse; reload preserves current global expansion. Keep Pi's two-state shortcut and custom bindings; do not add a key interceptor or persisted third mode. /minimal-display is status-only. Failed activation must preserve native state.

- Native thinking visibility is the single source of truth. Use Pi's hideThinkingBlock setting to choose whether thinking is shown; when shown, it remains visible and splits adjacent tool groups. For maximum compactness, users may disable it in Pi's native config.

## Invariants

- Presentation only: never register replacement tools, alter schemas/execute functions, touch credentials, mutate messages/session serialization/LLM context, or edit installed Pi/dependency files.
- Thinking visibility belongs solely to Pi's native hideThinkingBlock setting. The plugin never rewrites Assistant thinking content or exposes a duplicate switch; visible thinking remains a grouping boundary and may reduce visual compression.
- Patch owner: scoped, atomic install; idempotent disposal; no stacking on reload; restore only methods still owned by that instance. A stale wrapper left inside another extension's wrapper must become inert and release session references.
- Certified Pi release initially 0.85.0. Unknown/malformed versions or incompatible host shapes leave native behavior intact and report once. A peer range is not certification. Do not activate in noninteractive sessions.
- Existing renderer conflicts must not silently replace one another. An unsupported combination disables this extension with a useful message.

## Engineering gates

1. Config contract checks and version gate.
2. Real Pi components plus a real CLI loader probe establishing reversible presentation, mouse and keyboard expansion, direct array changes, replay and lifecycle behavior.
3. Actual packaged artifact test in a disposable profile, type checking, focused regressions and performance comparison on the same workload.
4. Independent correctness/spec review; resolve release blockers. Document tested and untested hosts accurately.
5. Prepare a release candidate, docs, provenance and package-file inspection. Public npm release/live-profile activation remain separate owner-authorized steps.

No timers, UI framework, custom shell/diff engine or runtime dependencies unless a verified requirement makes them necessary. Host-specific knowledge belongs together. License must be selected before publication; upstream reference has inconsistent ISC metadata/GPL LICENSE and is not copied.

### pi-minimal-display#2 — Validate configuration and certified-host policy

Issue · closed · opened 2026-09-05T08:58:37Z by AllenYolk · closed 2026-09-05T18:48:20Z · labels: `ready-for-agent`

Part of pi-minimal-display#1.

Implement the approved configuration and exact-host certification contract using Node built-in test runner and TypeScript. Acceptance: documented defaults, validated per-tool choices and numeric bounds, path follows the supplied Pi agent directory, absent config accepted, malformed/unreadable/unknown-key config returns native fallback plus actionable diagnostic. Unsupported host stays native. Tests observe settings/diagnostics through file loading; no prototype patch in this slice.

#### Comment by AllenYolk on 2026-09-05T09:21:52Z

Configuration acceptance is implemented, and pi-minimal-display#3 now tests runtime fallback for uncertified versions and real loading via Pi's profile. `npm run check`: 13 tests pass on Node 24.12.0 / Pi 0.85.0, including the real CLI ten-reload probe. Review and release gates remain open; no live profile was activated.

### pi-minimal-display#3 — Implement reversible grouping through the real Pi presentation interface

Issue · closed · opened 2026-09-05T08:58:42Z by AllenYolk · closed 2026-09-05T18:48:20Z · labels: `ready-for-agent`

Part of pi-minimal-display#1. Blocked by: pi-minimal-display#2.

Implement and verify the reversible runtime presentation interface against real Pi 0.85.0 components and CLI loader. Acceptance: mixed/count-only grouping, user/skill boundaries, native passthrough, complete native expansion, readable errors during pending work, clicks and configured expand key, direct transcript-array edits, thinking restoration/streaming, no tool or message mutation, reload ownership and unsupported-host fallback. Record any discovered limits before broadening scope.

### pi-minimal-display#4 — Verify and review the publishable release candidate

Issue · closed · opened 2026-09-05T08:58:45Z by AllenYolk · closed 2026-09-05T18:48:21Z · labels: `needs-triage`

Part of pi-minimal-display#1. Blocked by: pi-minimal-display#3.

Prepare a release candidate with type checking, real loader/lifecycle tests, packed-artifact inspection/load, same-host rendering benchmark, CI, provenance and user docs. Complete an independent standards/spec review. No npm publish or live-profile activation. License and actual publication remain owner decisions. Unverified hosts must not be advertised as certified.

#### Comment by AllenYolk on 2026-09-05T10:06:29Z

Release-candidate evidence for pi-minimal-display#4, covering configuration pi-minimal-display#2 and presentation pi-minimal-display#3.

- Independent comparison: `3b482e1...bc3c8b2`; runtime source unchanged since `065216d`. Standards: zero unresolved findings. Spec: zero unresolved findings. Prior findings are fixed with regressions.
- `npm run check`: 24/24, no skips. Linux/macOS × Node 22.19.0/24.12.0 all pass at the reviewed commit: https://github.com/AllenYolk/pi-minimal-display/actions/runs/33959587401.
- Real host evidence includes saved replay, branch/fork persistence, Ctrl+O, mouse, queue preservation, streaming/error/abort states, PNG protocol preservation, ten real CLI reloads, and actual packed-source loading.
- Recorded public Pi fixture benchmark: 914 messages/391 calls; native → compact medians 2.326 → 0.623 ms collapsed, 3.546 → 4.655 ms expanded. Expanded output adds retained-data detail; no universal performance claim.
- Package: MIT, source entry, no runtime dependencies or install lifecycle scripts. Production npm audit reports zero known vulnerabilities. No source copied from compact-display.
- Remaining coverage limits: provider-driven queue delivery, interactive fork selector, physical terminal images/other protocols, Windows and uncertified Pi versions. These are documented limits, not reopened blockers for the scoped candidate.

PRs remain drafts pending owner integration review. Stack order is pi-minimal-display#5 → pi-minimal-display#6 → pi-minimal-display#7; the completed stack is the candidate, and intermediate commits must not be released. No merge, npm publication, or daily-profile activation has been performed. Full review and validation details are in docs/validation.md on test/release-candidate.

### pi-minimal-display#5 — Validate profile display configuration

Pull request · closed · opened 2026-09-05T09:02:28Z by AllenYolk · closed 2026-09-05T18:48:20Z

Implements validated configuration for pi-minimal-display#2 under the presentation contract in pi-minimal-display#1. Missing profile configuration uses compact defaults; invalid input produces a path-bearing diagnostic and no active configuration, allowing the runtime to stay native.

Validation: `npm run check` passes configuration tests (defaults, supplied profile path, exact overrides, malformed roots/types/ranges/unknown fields). Runtime consumption and exact-host fallback will be exercised with pi-minimal-display#3; this draft is not a runnable release.

### pi-minimal-display#6 — Add reversible Pi turn presentation

Pull request · closed · opened 2026-09-05T09:21:49Z by AllenYolk · closed 2026-09-05T18:53:33Z

Implements pi-minimal-display#3 under pi-minimal-display#1. Group views are derived from the existing transcript at render time; no replacement tools or message/context rewrites are registered. Native expansion preserves host renderers. The adapter includes exact-version/shape gates, instance-owned disposal, thinking restoration, and mouse expansion.

Validation: `npm run check` passes 13 tests, including a real bundled Pi 0.85.0 CLI in a PTY executing a synthetic shell command and reloading ten times with alternating thinking visibility. Component regressions cover fallback, mixed turns, direct child-array edits, narrow output, and later wrapper ownership.

Use the TypeScript source entrypoint: the built ESM entry can resolve a separate host module instance in development. Packaging and independent review are tracked in pi-minimal-display#4.

#### Comment by AllenYolk on 2026-09-05T18:53:32Z

Superseded by merged release PR pi-minimal-display#23; all commits are present in v0.1.0.

### pi-minimal-display#7 — Verify the Pi display release candidate and fix review findings

Pull request · closed · opened 2026-09-05T09:43:51Z by AllenYolk · closed 2026-09-05T18:53:33Z

Release-candidate evidence for pi-minimal-display#4, covering configuration pi-minimal-display#2 and presentation pi-minimal-display#3.

- Independent comparison: `3b482e1...bc3c8b2`; runtime source unchanged since `065216d`. Standards: zero unresolved findings. Spec: zero unresolved findings. Prior findings are fixed with regressions.
- `npm run check`: 24/24, no skips. Linux/macOS × Node 22.19.0/24.12.0 all pass at the reviewed commit: https://github.com/AllenYolk/pi-minimal-display/actions/runs/33959587401.
- Real host evidence includes saved replay, branch/fork persistence, Ctrl+O, mouse, queue preservation, streaming/error/abort states, PNG protocol preservation, ten real CLI reloads, and actual packed-source loading.
- Recorded public Pi fixture benchmark: 914 messages/391 calls; native → compact medians 2.326 → 0.623 ms collapsed, 3.546 → 4.655 ms expanded. Expanded output adds retained-data detail; no universal performance claim.
- Package: MIT, source entry, no runtime dependencies or install lifecycle scripts. Production npm audit reports zero known vulnerabilities. No source copied from compact-display.
- Remaining coverage limits: provider-driven queue delivery, interactive fork selector, physical terminal images/other protocols, Windows and uncertified Pi versions. These are documented limits, not reopened blockers for the scoped candidate.

PRs remain drafts pending owner integration review. Stack order is pi-minimal-display#5 → pi-minimal-display#6 → pi-minimal-display#7; the completed stack is the candidate, and intermediate commits must not be released. No merge, npm publication, or daily-profile activation has been performed. Full review and validation details are in docs/validation.md on test/release-candidate.

#### Comment by AllenYolk on 2026-09-05T18:53:32Z

Superseded by merged release PR pi-minimal-display#23; all commits are present in v0.1.0.

### pi-minimal-display#8 — Simplify presentation lifetime ownership after Ponytail audit

Issue · closed · opened 2026-09-05T10:52:08Z by AllenYolk · closed 2026-09-05T18:48:21Z · labels: `ready-for-agent`

## Problem and scope

Ponytail audit requested by the owner. The internal installer returns a Presentation object containing a boolean and a disposer, including a disabled no-op implementation. The only production consumer needs an optional cleanup function. A separate owner-token object adds another representation of the same lifetime. Startup's failure catch attempts to dispose a result which could never have been assigned when the installer throws. Collapsed mouse handling recalculates expansion despite already establishing that all members are collapsed.

## Reviewed plan

- Installer owns installation, rollback and cleanup; return its dispose function on success, undefined on refusal. Use the same function as the instance-owner token.
- Entry point owns calling that function on session changes; remove dead catch cleanup.
- Keep all existing configuration, version/export/fingerprint checks, weak tracking and measured retained-view cache. These protect explicit external/lifecycle contracts, not speculative compatibility.
- Replace the collapsed-click recomputation with setExpanded(true).
- Internal callers/tests migrate atomically. No legacy return-object adapter, new framework, config or dependency. Public extension entry, configuration, diagnostics, rendering and session/model data stay unchanged.

Alternative: keep a wrapper object with only dispose; rejected because it still adds an unnecessary layer. Rollback is reverting this scoped commit, not modifying installed Pi.

## Acceptance and verification

Use the existing 24 behavioral checks as baseline; first adapt their internal installer contract and observe failures, then simplify implementation. Verify real host replay/keyboard/mouse/images, CLI and package loading, GC and ownership regressions. Compare the recorded-session benchmark before/after in the same Node/Pi environment, including output line counts. No change to released artifacts, npm publication or daily profile.

#### Comment by AllenYolk on 2026-09-05T11:01:35Z

Implemented in a158d7d, draft PR pi-minimal-display#9, stacked on test/release-candidate.

- Removed the Presentation result wrapper/flag/disabled no-op, separate owner token, unreachable startup cleanup, and redundant collapsed-click state check. Net production change: -13 lines, no new dependencies. Public contracts and required guards remain intact.
- All 24 checks pass, including real InteractiveMode, CLI reload, actual package loading, GC and owner regressions. CI Linux/macOS × Node 22/24 passed: https://github.com/AllenYolk/pi-minimal-display/actions/runs/33962043459.
- Five alternating before/after trials against a65066a: complete native and compact rendering hashes identical, using 914 messages/391 calls from the official public fixture. Compact output remains 1,996/24,802 lines. Measured folded 0.478→0.581ms; expanded4.713→5.047ms. No speedup claimed; independent reruns vary.
- Independent Standards: zero violations/actionable smells/blockers; reran24checks and byte comparison. Independent Spec: zero findings/reopened blockers; reran18focusedchecks and pinned byte comparison. Baseline for full review remained user-confirmed3b482e1; current delta a65066a..a158d7d.

No merge, publication, live-profile changes, installed-package patches, or overwrite of the previous candidate artifact. Issue remains open pending integration acceptance.

### pi-minimal-display#9 — Simplify presentation ownership after Ponytail audit

Pull request · closed · opened 2026-09-05T10:57:58Z by AllenYolk · closed 2026-09-05T18:53:33Z

## Problem and scope

Ponytail audit requested by the owner. The internal installer returns a Presentation object containing a boolean and a disposer, including a disabled no-op implementation. The only production consumer needs an optional cleanup function. A separate owner-token object adds another representation of the same lifetime. Startup's failure catch attempts to dispose a result which could never have been assigned when the installer throws. Collapsed mouse handling recalculates expansion despite already establishing that all members are collapsed.

## Reviewed plan

- Installer owns installation, rollback and cleanup; return its dispose function on success, undefined on refusal. Use the same function as the instance-owner token.
- Entry point owns calling that function on session changes; remove dead catch cleanup.
- Keep all existing configuration, version/export/fingerprint checks, weak tracking and measured retained-view cache. These protect explicit external/lifecycle contracts, not speculative compatibility.
- Replace the collapsed-click recomputation with setExpanded(true).
- Internal callers/tests migrate atomically. No legacy return-object adapter, new framework, config or dependency. Public extension entry, configuration, diagnostics, rendering and session/model data stay unchanged.

Alternative: keep a wrapper object with only dispose; rejected because it still adds an unnecessary layer. Rollback is reverting this scoped commit, not modifying installed Pi.

## Acceptance and verification

Use the existing 24 behavioral checks as baseline; first adapt their internal installer contract and observe failures, then simplify implementation. Verify real host replay/keyboard/mouse/images, CLI and package loading, GC and ownership regressions. Compare the recorded-session benchmark before/after in the same Node/Pi environment, including output line counts. No change to released artifacts, npm publication or daily profile.

#### Comment by AllenYolk on 2026-09-05T11:01:38Z

Implemented in a158d7d, draft PR pi-minimal-display#9, stacked on test/release-candidate.

- Removed the Presentation result wrapper/flag/disabled no-op, separate owner token, unreachable startup cleanup, and redundant collapsed-click state check. Net production change: -13 lines, no new dependencies. Public contracts and required guards remain intact.
- All 24 checks pass, including real InteractiveMode, CLI reload, actual package loading, GC and owner regressions. CI Linux/macOS × Node 22/24 passed: https://github.com/AllenYolk/pi-minimal-display/actions/runs/33962043459.
- Five alternating before/after trials against a65066a: complete native and compact rendering hashes identical, using 914 messages/391 calls from the official public fixture. Compact output remains 1,996/24,802 lines. Measured folded 0.478→0.581ms; expanded4.713→5.047ms. No speedup claimed; independent reruns vary.
- Independent Standards: zero violations/actionable smells/blockers; reran24checks and byte comparison. Independent Spec: zero findings/reopened blockers; reran18focusedchecks and pinned byte comparison. Baseline for full review remained user-confirmed3b482e1; current delta a65066a..a158d7d.

No merge, publication, live-profile changes, installed-package patches, or overwrite of the previous candidate artifact. Issue remains open pending integration acceptance.

#### Comment by AllenYolk on 2026-09-05T18:53:32Z

Superseded by merged release PR pi-minimal-display#23; all commits are present in v0.1.0.

### pi-minimal-display#10 — Preserve transcript order when grouping tool calls

Issue · closed · opened 2026-09-05T11:30:17Z by AllenYolk · closed 2026-09-05T18:48:21Z · labels: `ready-for-agent`

## User feedback and corrected contract

The owner reports five bash calls, assistant text/thinking, then three bash calls appearing as one eight-call group before the assistant output. Reproduced with work/reproduce-transcript-order.mjs: the later result appears before the intervening commentary although the original transcript child array is unchanged.

This supersedes issue pi-minimal-display#1's instruction to group across assistant text/thinking. Group only consecutive managed tool activity, within user-turn boundaries. Assistant text and thinking (including hidden thinking), native tools, custom output and user/skill content stop grouping. Empty assistant tool-call-only placeholders may be crossed because they contain no intervening narrative. Preserve the native transcript's tool/text relative order in collapsed and expanded views; do not claim to alter actual execution order.

Keep rendering-time projection, native expansion, retained-data access, configuration and all ownership/compatibility guards. No new options. The owner's question about the default Retained data appendix is answered separately; do not silently remove its only full-data access path as part of the ordering fix.

## Acceptance

- Five calls, commentary, three calls render as group5 → commentary → group3 in both collapsed and expanded views.
- Hidden thinking and native tools also divide groups; empty tool-call assistant placeholders do not split otherwise contiguous calls.
- Streaming narrative arrival recomputes grouping without changing session/model data.
- Existing real-host, package, CLI, lifecycle and error tests pass; rerun the public recorded-session benchmark.
- Update glossary/spec/README to distinguish a display group from a user turn. Keep the installed a158d7d trial snapshot untouched; an updated trial requires a separate deployment step.

#### Comment by AllenYolk on 2026-09-05T11:37:17Z

Fixes pi-minimal-display#10, stacked on pi-minimal-display#9. The root cause was keeping the previous group's member array alive while passing assistant/native content through: later calls were appended to a group already positioned before that content. The original transcript itself was never mutated.

Only consecutive managed calls now group. Narrative, hidden thinking, native tools and host warnings end the group; empty tool-call-only assistant placeholders do not. Current input/source data is inspected each render so streamed narrative starts a boundary immediately. The spec/glossary/README now reflect this corrected contract.

Validation: npm run check passes all26 tests, including the exact5→commentary→3 case, expanded ordering, streamed/hidden thinking, native tools, warnings, real InteractiveMode events, images, package/CLI load and lifecycle checks. Recorded391-call benchmark: collapsed0.515→0.730ms, expanded4.942→5.258ms, with more headers necessary for correct order. No speedup claimed.

The owner's currently installed a158d7d snapshot remains byte-for-byte unchanged. Retained data default presentation remains a separate UX decision; this fix does not remove its current access path. Draft pending independent review and any separately authorized trial deployment.

### pi-minimal-display#11 — Preserve tool and narrative order in display groups

Pull request · closed · opened 2026-09-05T11:37:15Z by AllenYolk · closed 2026-09-05T18:53:33Z

Fixes pi-minimal-display#10, stacked on pi-minimal-display#9. The root cause was keeping the previous group's member array alive while passing assistant/native content through: later calls were appended to a group already positioned before that content. The original transcript itself was never mutated.

Only consecutive managed calls now group. Narrative, hidden thinking, native tools and host warnings end the group; empty tool-call-only assistant placeholders do not. Current input/source data is inspected each render so streamed narrative starts a boundary immediately. The spec/glossary/README now reflect this corrected contract.

Validation: npm run check passes all26 tests, including the exact5→commentary→3 case, expanded ordering, streamed/hidden thinking, native tools, warnings, real InteractiveMode events, images, package/CLI load and lifecycle checks. Recorded391-call benchmark: collapsed0.515→0.730ms, expanded4.942→5.258ms, with more headers necessary for correct order. No speedup claimed.

The owner's currently installed a158d7d snapshot remains byte-for-byte unchanged. Retained data default presentation remains a separate UX decision; this fix does not remove its current access path. Draft pending independent review and any separately authorized trial deployment.

#### Comment by AllenYolk on 2026-09-05T18:53:32Z

Superseded by merged release PR pi-minimal-display#23; all commits are present in v0.1.0.

### pi-minimal-display#12 — Use native expansion without the Retained data appendix and update trial

Issue · closed · opened 2026-09-05T11:49:12Z by AllenYolk · closed 2026-09-05T18:48:22Z · labels: `ready-for-agent`

## Owner-approved behavior

Remove the default Retained data appendix and deploy a trial containing both this change and the ordered grouping fix pi-minimal-display#10. Ctrl+O delegates to Pi's native tool renderers; do not append serialized arguments/results/details or add a replacement raw-data UI/configuration option. Raw session/model/tool data remains unchanged. This supersedes the original pi-minimal-display#1 requirement to expose every retained block through an extra expanded-view appendix; native renderer omissions (such as successful write text) are now intentional native behavior.

Delete the appendix serialization and its weak cache. Keep native controls, images, errors, group expansion for arriving members, ordering, and lifecycle/compatibility protections. Verify full native expanded-output equality and unchanged retained/session payloads, not just absence of a heading.

## Acceptance and deployment

- Native expanded output has no plugin-created Retained data block and is byte-identical to unmodified Pi for the same tool components.
- Five calls → narrative → three calls remains ordered collapsed and expanded, including real-host verification.
- Existing lifecycle, package/CLI and image checks pass; benchmark same recorded fixture before and after.
- Independent review and CI before trial replacement.
- Deploy a fixed snapshot into the owner's verified Pi0.85.0 profile; preserve unrelated current settings and the old snapshot for rollback. Update the uninstall helper to target the new trial, verify uninstall/native recovery and final reinstallation. No npm publication or installed Pi core modification.

#### Comment by AllenYolk on 2026-09-05T12:01:28Z

Implemented and deployed commit324ee3d, rc.2, including ordering fix#10 and native expansion#12.

Standards review: no violations/actionable smells/code blockers; independently ran27checks and recorded benchmark. Spec review: no missing/incorrect requirements or scope creep; verified native expanded-output byte equality with thinking visibility held equal. The revised issue1 contract explicitly supersedes whole-turn grouping and the raw-data appendix.

Pinned CI Linux/macOS × Node22/24 passed: https://github.com/AllenYolk/pi-minimal-display/actions/runs/33964549317. Package has only the three source files, README, LICENSE and metadata; appendix cache/serialization removed, no new dependencies.

Owner-authorized real-profile deployment verified using their existing Pi0.85.0 CLI: old trial unregistered, new fixed snapshot registered; exact5→text→3 ordering and no appendix confirmed. Updated uninstall helper tested on the actual profile: native behavior restored, unrelated settings unchanged. Reinstalled and reverified new snapshot; final state new trial active, old snapshot retained but unregistered. Pi CLI checksum unchanged. No LLM calls, npm publication, PR merge, or installed-core edits.

Draft PR#13 contains the rc.2 delta, stacked on ordering PR#11. Remaining issue state is for integration/user experience feedback, not an unfinished rollout.

### pi-minimal-display#13 — Use native expanded details and prepare rc.2 trial

Pull request · closed · opened 2026-09-05T11:53:52Z by AllenYolk · closed 2026-09-05T18:53:33Z

## Owner-approved behavior

Remove the default Retained data appendix and deploy a trial containing both this change and the ordered grouping fix pi-minimal-display#10. Ctrl+O delegates to Pi's native tool renderers; do not append serialized arguments/results/details or add a replacement raw-data UI/configuration option. Raw session/model/tool data remains unchanged. This supersedes the original pi-minimal-display#1 requirement to expose every retained block through an extra expanded-view appendix; native renderer omissions (such as successful write text) are now intentional native behavior.

Delete the appendix serialization and its weak cache. Keep native controls, images, errors, group expansion for arriving members, ordering, and lifecycle/compatibility protections. Verify full native expanded-output equality and unchanged retained/session payloads, not just absence of a heading.

## Acceptance and deployment

- Native expanded output has no plugin-created Retained data block and is byte-identical to unmodified Pi for the same tool components.
- Five calls → narrative → three calls remains ordered collapsed and expanded, including real-host verification.
- Existing lifecycle, package/CLI and image checks pass; benchmark same recorded fixture before and after.
- Independent review and CI before trial replacement.
- Deploy a fixed snapshot into the owner's verified Pi0.85.0 profile; preserve unrelated current settings and the old snapshot for rollback. Update the uninstall helper to target the new trial, verify uninstall/native recovery and final reinstallation. No npm publication or installed Pi core modification.

#### Comment by AllenYolk on 2026-09-05T12:01:30Z

Implemented and deployed commit324ee3d, rc.2, including ordering fix#10 and native expansion#12.

Standards review: no violations/actionable smells/code blockers; independently ran27checks and recorded benchmark. Spec review: no missing/incorrect requirements or scope creep; verified native expanded-output byte equality with thinking visibility held equal. The revised issue1 contract explicitly supersedes whole-turn grouping and the raw-data appendix.

Pinned CI Linux/macOS × Node22/24 passed: https://github.com/AllenYolk/pi-minimal-display/actions/runs/33964549317. Package has only the three source files, README, LICENSE and metadata; appendix cache/serialization removed, no new dependencies.

Owner-authorized real-profile deployment verified using their existing Pi0.85.0 CLI: old trial unregistered, new fixed snapshot registered; exact5→text→3 ordering and no appendix confirmed. Updated uninstall helper tested on the actual profile: native behavior restored, unrelated settings unchanged. Reinstalled and reverified new snapshot; final state new trial active, old snapshot retained but unregistered. Pi CLI checksum unchanged. No LLM calls, npm publication, PR merge, or installed-core edits.

Draft PR#13 contains the rc.2 delta, stacked on ordering PR#11. Remaining issue state is for integration/user experience feedback, not an unfinished rollout.

#### Comment by AllenYolk on 2026-09-05T18:53:32Z

Superseded by merged release PR pi-minimal-display#23; all commits are present in v0.1.0.

### pi-minimal-display#14 — Render native summary cards and activate minimal display for ordinary tools

Issue · closed · opened 2026-09-05T13:15:17Z by AllenYolk · closed 2026-09-05T18:48:22Z · labels: `ready-for-agent`

## Owner-approved implementation plan

Implement native-style summary cards and automatic minimal display. Both regular and fullscreen must show minimal before any command/key input. /minimal-display remains status-only. No three-state cycle or shortcut interception.

Cards use native Box/Spacer/mouse routing: one preceding blank line, one-column horizontal and one-row vertical padding; bold toolTitle count line and status/shortcut line. Read current theme on every render; failure background wins over pending, then success. Colored padding is clickable, preceding gap is not. Keep native expanded output and ordered groups; no raw appendix.

On successful startup/new/resume/fork installation, use the public expansion setter to select collapsed/minimal. Reload retains current global expansion. Native Pi state is authoritative; no new persisted mode or key handler. Unsupported host/config/conflict leaves original expansion intact. Release the theme UI reference on disposal.

Default becomes count_only for all ordinary tools, including real names such as readSeek_edit/readSeek_grep. Keep exact tools overrides and grouping/lines semantics. Default native exclusions: ask_user_question, plan_mode_question, plan_mode_complete. Do not infer interactive tools by fuzzy name; new interactive tools require explicit native configuration. Real registered names identify counts.

## Acceptance

- Existing config/lifecycle/render/real-host/package seams remain approved. Test-first vertical slices.
- No-command/key first paint: fresh streamed calls and resumed session, regular and fullscreen; status query does not activate anything.
- Built-in/ReadSeek/custom coverage, native exclusions, exact overrides.
- Global Ctrl+O/custom binding, local clicks including padding/gap/resized view, session reasons and reload preservation.
- Dark/light theme, mixed failure/pending, narrow wrap, ordered tool/narrative output, native expanded/images and raw-data invariants, GC/teardown.
- Recorded-session before/after benchmark; extra card rows are intended, not a regression by themselves.
- Independent Standards/Spec and full CI before daily trial promotion. Preserve prior snapshot/unrelated settings, update and exercise uninstall, finally reinstall the new fixed snapshot. No npm publication or Pi core edits.

This implementation request supersedes the previous planning-turn-only restriction. This issue updates the applicable defaults/presentation parts of issue pi-minimal-display#1.

#### Comment by AllenYolk on 2026-09-05T14:09:19Z

Implemented and deployed reviewed commit8dad308 (rc.3), draft PR#15. All approved pi-minimal-display#14 behaviors are present: native-theme two-line cards/padding/mouse routing, ordinary-tool default coverage with exact interactive exclusions, automatic minimal session entry and reload preservation using native two-state expansion only.

Standards: no violations/actionable smells/blockers; independently reran37checks and alternating benchmark. Spec: no missing/wrong requirements/scope creep; independently reran37checks and validated actual ExtensionRunner theme wrapping. CI Linux/macOS × Node22/24 all pass at exact SHA: https://github.com/AllenYolk/pi-minimal-display/actions/runs/33970219682.

No-input first paint succeeds in real bundled CLI regular/fullscreen fresh/resume; an rc.2 negative control fails on raw tool output. Actual Ctrl+O/customCtrl+G, local/global clicks, colored padding vs gap, themes/status, 10reloads, native output/images, failed-transition rollback and UI/session GC pass. Fresh events are deterministic host-lifecycle injection, not provider execution.

Five alternating public391-call trials: collapsed2135→2983lines and0.698→1.902ms; expanded14889lines and full output hash unchanged,3.616→3.637ms. Added card space/work is intended, no speedup claim.

Owner-authorized promotion used their same Pi0.85.0 and real profile. New snapshot registered, old rc.2 unregistered but retained. Actual profile no-command first paint, card layout, edit/grep/ReadSeek/custom coverage and interactive exclusion verified. Updated uninstall helper successfully restored native behavior and preserved unrelated settings; new snapshot reinstalled and reverified. Pi CLI checksum unchanged. No npm publication or PR merge. Issue stays open for integration/user feedback, not incomplete deployment.

### pi-minimal-display#15 — Add native summary cards and automatic minimal display

Pull request · closed · opened 2026-09-05T13:53:49Z by AllenYolk · closed 2026-09-05T18:53:33Z

## Owner-approved implementation plan

Implement native-style summary cards and automatic minimal display. Both regular and fullscreen must show minimal before any command/key input. /minimal-display remains status-only. No three-state cycle or shortcut interception.

Cards use native Box/Spacer/mouse routing: one preceding blank line, one-column horizontal and one-row vertical padding; bold toolTitle count line and status/shortcut line. Read current theme on every render; failure background wins over pending, then success. Colored padding is clickable, preceding gap is not. Keep native expanded output and ordered groups; no raw appendix.

On successful startup/new/resume/fork installation, use the public expansion setter to select collapsed/minimal. Reload retains current global expansion. Native Pi state is authoritative; no new persisted mode or key handler. Unsupported host/config/conflict leaves original expansion intact. Release the theme UI reference on disposal.

Default becomes count_only for all ordinary tools, including real names such as readSeek_edit/readSeek_grep. Keep exact tools overrides and grouping/lines semantics. Default native exclusions: ask_user_question, plan_mode_question, plan_mode_complete. Do not infer interactive tools by fuzzy name; new interactive tools require explicit native configuration. Real registered names identify counts.

## Acceptance

- Existing config/lifecycle/render/real-host/package seams remain approved. Test-first vertical slices.
- No-command/key first paint: fresh streamed calls and resumed session, regular and fullscreen; status query does not activate anything.
- Built-in/ReadSeek/custom coverage, native exclusions, exact overrides.
- Global Ctrl+O/custom binding, local clicks including padding/gap/resized view, session reasons and reload preservation.
- Dark/light theme, mixed failure/pending, narrow wrap, ordered tool/narrative output, native expanded/images and raw-data invariants, GC/teardown.
- Recorded-session before/after benchmark; extra card rows are intended, not a regression by themselves.
- Independent Standards/Spec and full CI before daily trial promotion. Preserve prior snapshot/unrelated settings, update and exercise uninstall, finally reinstall the new fixed snapshot. No npm publication or Pi core edits.

This implementation request supersedes the previous planning-turn-only restriction. This issue updates the applicable defaults/presentation parts of issue pi-minimal-display#1.

#### Comment by AllenYolk on 2026-09-05T14:09:21Z

Implemented and deployed reviewed commit8dad308 (rc.3), draft PR#15. All approved pi-minimal-display#14 behaviors are present: native-theme two-line cards/padding/mouse routing, ordinary-tool default coverage with exact interactive exclusions, automatic minimal session entry and reload preservation using native two-state expansion only.

Standards: no violations/actionable smells/blockers; independently reran37checks and alternating benchmark. Spec: no missing/wrong requirements/scope creep; independently reran37checks and validated actual ExtensionRunner theme wrapping. CI Linux/macOS × Node22/24 all pass at exact SHA: https://github.com/AllenYolk/pi-minimal-display/actions/runs/33970219682.

No-input first paint succeeds in real bundled CLI regular/fullscreen fresh/resume; an rc.2 negative control fails on raw tool output. Actual Ctrl+O/customCtrl+G, local/global clicks, colored padding vs gap, themes/status, 10reloads, native output/images, failed-transition rollback and UI/session GC pass. Fresh events are deterministic host-lifecycle injection, not provider execution.

Five alternating public391-call trials: collapsed2135→2983lines and0.698→1.902ms; expanded14889lines and full output hash unchanged,3.616→3.637ms. Added card space/work is intended, no speedup claim.

Owner-authorized promotion used their same Pi0.85.0 and real profile. New snapshot registered, old rc.2 unregistered but retained. Actual profile no-command first paint, card layout, edit/grep/ReadSeek/custom coverage and interactive exclusion verified. Updated uninstall helper successfully restored native behavior and preserved unrelated settings; new snapshot reinstalled and reverified. Pi CLI checksum unchanged. No npm publication or PR merge. Issue stays open for integration/user feedback, not incomplete deployment.

#### Comment by AllenYolk on 2026-09-05T18:53:32Z

Superseded by merged release PR pi-minimal-display#23; all commits are present in v0.1.0.

### pi-minimal-display#16 — Silence native tool expansion notifications without changing transcript content

Issue · closed · opened 2026-09-05T14:38:47Z by AllenYolk · closed 2026-09-05T18:48:23Z · labels: `ready-for-agent`

## Owner choice

The owner selected option1: remove redundant Tool output: expanded/collapsed notifications entirely. Do not move them to Starship, add a widget/toast/timer/configuration, or intercept keyboard input.

Keep the original native expansion function and its state changes. During that synchronous native call only, suppress its exact mode notification through a temporary instance-local showStatus adapter. Preserve every other status and identical text outside that native action, including assistant/tool content. Explicitly request render after the call because the original notification supplied redraw. Restore the original own-property descriptor (or inherited method) even on failure; never overwrite a newer owner. The permanent setter wrapper must be certified, owned, reversible and inert after disposal, like existing presentation wrappers.

No global string-based transcript filtering and no copying/replacing Pi's expansion algorithm. Existing UI-only status lines disappear on session reconstruction/restart; do not rewrite saved session data or silently delete arbitrary existing text components.

## Acceptance

- Real host Ctrl+O and rebound shortcut keep toggling native state and repaint without adding either native toggle message or its spacer.
- Toggle between tool batches no longer creates artificial group boundaries; real text/thinking/status content still separates groups.
- Exact phrase in agent/tool output and direct status calls outside the action remains visible. Other status calls within the action remain visible.
- Native setter throw path restores temporary routing; disposal, prior/later owner handling, GC, print/RPC inactivity and all prior contracts pass.
- Certify both SDK/bundled native setter+showStatus implementations before patching. Run real CLI reload/package/first-paint, host tests, CI and independent review before a fixed trial update.
- Preserve prior snapshot/current settings, update and exercise uninstall/native recovery, then reinstall new trial. No Pi core edits or npm publication.

#### Comment by AllenYolk on 2026-09-05T15:01:13Z

Implemented, reviewed and deployed exact commit 2080bea / rc.4 in draft PR pi-minimal-display#17.

- Native setToolsExpanded remains authoritative. Only its exact synchronous Tool output status is suppressed; repaint, unrelated statuses and matching text outside the action remain. No transcript string filtering, Starship integration, timer/widget/config/key interception or copied native algorithm.
- Initial Standards review reproduced an escaped temporary wrapper that could keep filtering. The action-scoped flag now expires unconditionally in finally. Real-host regression verifies matching status after return and after disposal. Final Standards: zero blockers/smells/breaches. Spec: zero implementation blockers; its rollout-only finding is resolved below.
- 38/38 local checks and exact-SHA Linux/macOS × Node22/24 CI pass: https://github.com/AllenYolk/pi-minimal-display/actions/runs/33973114461. Real CtrlO/customCtrlG, ten CLI reloads, later-call grouping, failure restoration, prior/later wrapper ownership, first paint, package, native expansion and UI/session GC are covered.
- Owner-authorized daily-profile rollout: old rc.3 unregistered and retained; rc.4 fixed snapshot registered. Actual profile minimal→expanded→minimal driver sent only two CtrlO inputs and observed no mode notification. Uninstall helper restored native behavior and exact unrelated settings; rc.4 was reinstalled and reverified. Pi core checksum unchanged. Final state: rc.4 active only.

No LLM calls, npm publication, PR merge, Pi-core edits, Starship changes or deletion of old snapshots.

### pi-minimal-display#17 — Silence native tool expansion status

Pull request · closed · opened 2026-09-05T14:47:31Z by AllenYolk · closed 2026-09-05T18:53:33Z

## Owner choice

The owner selected option1: remove redundant Tool output: expanded/collapsed notifications entirely. Do not move them to Starship, add a widget/toast/timer/configuration, or intercept keyboard input.

Keep the original native expansion function and its state changes. During that synchronous native call only, suppress its exact mode notification through a temporary instance-local showStatus adapter. Preserve every other status and identical text outside that native action, including assistant/tool content. Explicitly request render after the call because the original notification supplied redraw. Restore the original own-property descriptor (or inherited method) even on failure; never overwrite a newer owner. The permanent setter wrapper must be certified, owned, reversible and inert after disposal, like existing presentation wrappers.

No global string-based transcript filtering and no copying/replacing Pi's expansion algorithm. Existing UI-only status lines disappear on session reconstruction/restart; do not rewrite saved session data or silently delete arbitrary existing text components.

## Acceptance

- Real host Ctrl+O and rebound shortcut keep toggling native state and repaint without adding either native toggle message or its spacer.
- Toggle between tool batches no longer creates artificial group boundaries; real text/thinking/status content still separates groups.
- Exact phrase in agent/tool output and direct status calls outside the action remains visible. Other status calls within the action remain visible.
- Native setter throw path restores temporary routing; disposal, prior/later owner handling, GC, print/RPC inactivity and all prior contracts pass.
- Certify both SDK/bundled native setter+showStatus implementations before patching. Run real CLI reload/package/first-paint, host tests, CI and independent review before a fixed trial update.
- Preserve prior snapshot/current settings, update and exercise uninstall/native recovery, then reinstall new trial. No Pi core edits or npm publication.

#### Comment by AllenYolk on 2026-09-05T15:01:15Z

Implemented, reviewed and deployed exact commit 2080bea / rc.4 in draft PR pi-minimal-display#17.

- Native setToolsExpanded remains authoritative. Only its exact synchronous Tool output status is suppressed; repaint, unrelated statuses and matching text outside the action remain. No transcript string filtering, Starship integration, timer/widget/config/key interception or copied native algorithm.
- Initial Standards review reproduced an escaped temporary wrapper that could keep filtering. The action-scoped flag now expires unconditionally in finally. Real-host regression verifies matching status after return and after disposal. Final Standards: zero blockers/smells/breaches. Spec: zero implementation blockers; its rollout-only finding is resolved below.
- 38/38 local checks and exact-SHA Linux/macOS × Node22/24 CI pass: https://github.com/AllenYolk/pi-minimal-display/actions/runs/33973114461. Real CtrlO/customCtrlG, ten CLI reloads, later-call grouping, failure restoration, prior/later wrapper ownership, first paint, package, native expansion and UI/session GC are covered.
- Owner-authorized daily-profile rollout: old rc.3 unregistered and retained; rc.4 fixed snapshot registered. Actual profile minimal→expanded→minimal driver sent only two CtrlO inputs and observed no mode notification. Uninstall helper restored native behavior and exact unrelated settings; rc.4 was reinstalled and reverified. Pi core checksum unchanged. Final state: rc.4 active only.

No LLM calls, npm publication, PR merge, Pi-core edits, Starship changes or deletion of old snapshots.

#### Comment by AllenYolk on 2026-09-05T18:53:32Z

Superseded by merged release PR pi-minimal-display#23; all commits are present in v0.1.0.

### pi-minimal-display#18 — Delegate thinking visibility entirely to Pi native configuration

Issue · closed · opened 2026-09-05T15:25:19Z by AllenYolk · closed 2026-09-05T18:48:23Z · labels: `ready-for-agent`

## Owner-approved contract

Pi's native `hideThinkingBlock` setting is the only thinking-visibility authority. Remove `hideThinking` from the plugin's runtime Config and stop patching AssistantMessageComponent.updateContent/render. Grouping still observes the host Assistant component's authoritative message content: visible thinking is a narrative boundary and hidden thinking remains a boundary even though Pi renders its native hidden label.

The old plugin boolean may be accepted and ignored for migration so an existing config does not disable the display; it must not appear in the resulting Config or influence rendering. Document the migration and recommend disabling thinking through Pi native settings when maximum tool-group compression is desired.

Keep tool execution, session/model data, streaming arguments, native rendering, image/control behavior, ordered grouping, ordinary-tool defaults, silent expansion and all lifecycle/version/owner safeguards unchanged. `/minimal-display` may report `thinking follows Pi` but never control it.

## Acceptance

- Missing config has no plugin thinking field; legacy boolean is ignored; invalid legacy type remains a config diagnostic.
- Native hidden and native visible Assistant components render exactly as before with the plugin installed; plugin Assistant prototypes remain untouched.
- Real host first paint/replay/streaming and group-boundary tests use native visibility, with visible thinking splitting groups.
- Existing 38 checks plus package/CLI/benchmark pass; no provider or live-profile mutations during repo tests.
- Independent Standards/Spec review and full CI pass. Existing rc.4 daily trial remains untouched unless a later owner authorizes rc.5 promotion.

#### Comment by AllenYolk on 2026-09-05T15:34:51Z

Implemented native-thinking-config at exact commit 7c59205 on PR pi-minimal-display#19.

- Pi native `hideThinkingBlock` is the sole thinking-visibility authority. Removed the plugin Config field from runtime output and removed Assistant update/render filtering, hashes and tracking. Visible thinking remains a native transcript boundary and can reduce tool-group compression.
- A legacy boolean `hideThinking` is validated and discarded only to keep old configs loadable; it no longer affects rendering. README recommends changing Pi's native setting for maximum compression.
- 39/39 local checks pass. The recorded 914-entry/391-call benchmark shows native and plugin expanded output at the same 14,892 lines; no provider/model performance claim.
- Independent Standards review: 0 findings, 0 blockers. Independent Spec review: 0 findings, 0 blockers. Final CI: 10/10 Linux/macOS × Node22/24 checks passed at 7c59205.
- Current rc.4 daily trial and profile were intentionally not modified. No npm publication or Pi-core edit.

#### Comment by AllenYolk on 2026-09-05T15:45:40Z

Implemented native-thinking-config at exact commit 7c59205 on PR pi-minimal-display#19.

- Pi native `hideThinkingBlock` is the sole thinking-visibility authority. Removed the plugin Config field from runtime output and removed Assistant update/render filtering, hashes and tracking. Visible thinking remains a native transcript boundary and can reduce tool-group compression.
- A legacy boolean `hideThinking` is validated and discarded only to keep old configs loadable; it no longer affects rendering. README recommends changing Pi's native setting for maximum compression.
- 39/39 local checks pass. The recorded 914-entry/391-call benchmark shows native and plugin expanded output at the same 14,892 lines; no provider/model performance claim.
- Independent Standards review: 0 findings, 0 blockers. Independent Spec review: 0 findings, 0 blockers. Final CI: 10/10 Linux/macOS × Node22/24 checks passed at 7c59205.
- Current rc.4 daily trial and profile were intentionally not modified. No npm publication or Pi-core edit.

#### Comment by AllenYolk on 2026-09-05T15:45:59Z

Owner-authorized rc.5 deployment completed.

- Fixed source commit 7c59205 / package 0.1.0-rc.5 was unpacked to `/Users/allenyolk/.pi/agent/local/pi-minimal-display-trial-7c59205` and registered in daily `/Users/allenyolk/.pi/agent`.
- Previous rc.4 registration was unregistered but its snapshot remains for rollback. Current registration occurs once; unrelated settings equal the pre-upgrade settings after replacing only the trial package entry.
- Real profile verification observed Pi native `hideThinkingBlock=false` expose `LIVE_NATIVE_THINKING` under the actual CLI/plugin. No LLM request.
- Updated uninstall helper was executed: active false/native recovery and unrelated settings preservation verified. rc.5 was reinstalled and the native-thinking check repeated successfully.
- Current final state is rc.5 active. Pi CLI checksum unchanged. No npm publication or Pi-core edit.

### pi-minimal-display#19 — Delegate thinking visibility to Pi native config

Pull request · closed · opened 2026-09-05T15:26:38Z by AllenYolk · closed 2026-09-05T18:53:33Z

## Owner-approved contract

Pi's native `hideThinkingBlock` setting is the only thinking-visibility authority. Remove `hideThinking` from the plugin's runtime Config and stop patching AssistantMessageComponent.updateContent/render. Grouping still observes the host Assistant component's authoritative message content: visible thinking is a narrative boundary and hidden thinking remains a boundary even though Pi renders its native hidden label.

The old plugin boolean may be accepted and ignored for migration so an existing config does not disable the display; it must not appear in the resulting Config or influence rendering. Document the migration and recommend disabling thinking through Pi native settings when maximum tool-group compression is desired.

Keep tool execution, session/model data, streaming arguments, native rendering, image/control behavior, ordered grouping, ordinary-tool defaults, silent expansion and all lifecycle/version/owner safeguards unchanged. `/minimal-display` may report `thinking follows Pi` but never control it.

## Acceptance

- Missing config has no plugin thinking field; legacy boolean is ignored; invalid legacy type remains a config diagnostic.
- Native hidden and native visible Assistant components render exactly as before with the plugin installed; plugin Assistant prototypes remain untouched.
- Real host first paint/replay/streaming and group-boundary tests use native visibility, with visible thinking splitting groups.
- Existing 38 checks plus package/CLI/benchmark pass; no provider or live-profile mutations during repo tests.
- Independent Standards/Spec review and full CI pass. Existing rc.4 daily trial remains untouched unless a later owner authorizes rc.5 promotion.

#### Comment by AllenYolk on 2026-09-05T15:34:55Z

Implemented native-thinking-config at exact commit 7c59205 on PR pi-minimal-display#19.

- Pi native `hideThinkingBlock` is the sole thinking-visibility authority. Removed the plugin Config field from runtime output and removed Assistant update/render filtering, hashes and tracking. Visible thinking remains a native transcript boundary and can reduce tool-group compression.
- A legacy boolean `hideThinking` is validated and discarded only to keep old configs loadable; it no longer affects rendering. README recommends changing Pi's native setting for maximum compression.
- 39/39 local checks pass. The recorded 914-entry/391-call benchmark shows native and plugin expanded output at the same 14,892 lines; no provider/model performance claim.
- Independent Standards review: 0 findings, 0 blockers. Independent Spec review: 0 findings, 0 blockers. Final CI: 10/10 Linux/macOS × Node22/24 checks passed at 7c59205.
- Current rc.4 daily trial and profile were intentionally not modified. No npm publication or Pi-core edit.

#### Comment by AllenYolk on 2026-09-05T15:46:02Z

Owner-authorized rc.5 deployment completed.

- Fixed source commit 7c59205 / package 0.1.0-rc.5 was unpacked to `/Users/allenyolk/.pi/agent/local/pi-minimal-display-trial-7c59205` and registered in daily `/Users/allenyolk/.pi/agent`.
- Previous rc.4 registration was unregistered but its snapshot remains for rollback. Current registration occurs once; unrelated settings equal the pre-upgrade settings after replacing only the trial package entry.
- Real profile verification observed Pi native `hideThinkingBlock=false` expose `LIVE_NATIVE_THINKING` under the actual CLI/plugin. No LLM request.
- Updated uninstall helper was executed: active false/native recovery and unrelated settings preservation verified. rc.5 was reinstalled and the native-thinking check repeated successfully.
- Current final state is rc.5 active. Pi CLI checksum unchanged. No npm publication or Pi-core edit.

#### Comment by AllenYolk on 2026-09-05T18:53:32Z

Superseded by merged release PR pi-minimal-display#23; all commits are present in v0.1.0.

### pi-minimal-display#20 — Omit native hidden-thinking placeholders from compact presentation

Issue · closed · opened 2026-09-05T15:56:48Z by AllenYolk · closed 2026-09-05T18:48:24Z · labels: `ready-for-human`

## Owner-approved contract

When Pi native `hideThinkingBlock` is enabled, pi-minimal-display omits the native `Thinking...` placeholder and treats hidden thinking as no visible transcript boundary, so adjacent managed tool calls in the same user turn may merge. When native thinking is visible, thinking remains unchanged and continues to split groups. Visible assistant text, native tools, warnings, user turns, and skill invocations remain boundaries.

Pi remains the only runtime thinking-visibility authority. The plugin must not add, persist, or derive a second visibility setting. The legacy plugin `hideThinking` key may continue to be type-checked and ignored for the migration already approved in pi-minimal-display#18; it must never influence rendering. Session/model content must remain unchanged, and disposal must restore native Assistant rendering.

## Acceptance

- Hidden pure thinking renders no placeholder and does not split adjacent managed tools.
- Hidden thinking mixed with visible assistant text omits only thinking; text remains visible and splits groups.
- Visible thinking remains native and splits groups.
- Runtime toggling follows the native component state.
- Disposal restores native output; streaming, retained session data, ordering, mouse behavior, and certified-host safeguards remain intact.
- Repository checks, real-host checks, package checks, benchmark, independent Standards/Spec review, and CI pass before trial deployment.

#### Comment by AllenYolk on 2026-09-05T16:18:36Z

## rc.6 validation — `1aede410604edfef12b8f284a7189d1f6b8db434`

- `npm run check`: 40/40 passed, including bundled CLI reload, regular/fullscreen first paint, real `InteractiveMode`, package tarball, lifecycle/GC and presentation tests.
- Hidden thinking: no content or `Thinking...` label; hidden-only Assistant components no longer split same-turn managed tools.
- Mixed content: hidden thinking is omitted while visible assistant text remains in order and remains a boundary.
- Native authority: runtime hide/show follows `AssistantMessageComponent.hideThinkingBlock`; no plugin visibility field was added. Legacy `hideThinking` remains type-checked and ignored per pi-minimal-display#18.
- Recovery: disposal restores native Assistant methods and the native hidden placeholder; session/model content, streaming state, images, controls and tool results remain unchanged.
- Performance: same synthetic 320-call workload, rc.5 → rc.6 compact median 0.854 → 0.704 ms collapsed and 1.855 → 2.091 ms expanded; lines unchanged at 320/5,560. No performance claim.
- Independent review against `7c59205...1aede41`: Standards 0 blockers; Spec 0 blockers after naming and issue wording corrections.
- GitHub Actions on the exact commit: 10/10 passed across macOS/Ubuntu and Node 22/24 plus upstream-version checks.

Draft PR: pi-minimal-display#21. Trial deployment may proceed; publication/merge remains separate.

### pi-minimal-display#21 — Omit hidden thinking placeholders from compact display

Pull request · closed · opened 2026-09-05T16:16:25Z by AllenYolk · closed 2026-09-05T18:53:33Z

Closes pi-minimal-display#20

## Summary
- follow Pi native `hideThinkingBlock` without adding plugin state
- omit hidden `Thinking...` placeholders and merge adjacent managed tools
- preserve visible text/thinking boundaries and restore native rendering on disposal

## Validation
- `npm run check` (40/40)
- synthetic 320-call benchmark compared with rc.5
- independent Standards review: 0 blockers
- independent Spec review: 0 blockers

#### Comment by AllenYolk on 2026-09-05T18:53:32Z

Superseded by merged release PR pi-minimal-display#23; all commits are present in v0.1.0.

### pi-minimal-display#22 — Prepare first GitHub release v0.1.0

Issue · closed · opened 2026-09-05T18:16:37Z by AllenYolk · closed 2026-09-05T18:48:24Z · labels: `ready-for-human`

## Goal

Prepare and publish the first GitHub release as `v0.1.0`. npm publication is explicitly deferred.

## Release contract

- Merge the reviewed implementation to `main` without losing issue-sized history.
- Support Pi's documented Git package source: `git:github.com/AllenYolk/pi-minimal-display` and the pinned `@v0.1.0` form.
- Do not gate activation on Pi's version string. Accept tested presentation-method signatures and required host shapes; fail closed to native display when the patched seam changes.
- Test Pi 0.85.0 and current 0.85.1. Keep Pi core packages as unbundled `*` peers per official package guidance.
- Treat release tags as immutable. Later fixes use new SemVer tags; unpinned Git installs may update with `pi update --extensions` or `pi update --all`, while pinned refs remain fixed.

## Acceptance

- README and release notes document Git install, update, pinning and removal.
- `npm pack --dry-run --json` still contains only the six intended files and no lifecycle scripts, runtime dependencies, secrets or generated artifacts.
- Full checks and benchmark pass on Pi 0.85.1; the final code is also checked against Pi 0.85.0.
- Independent Standards/Spec review and GitHub CI pass on the release commit.
- Merge to `main`, tag the exact commit `v0.1.0`, create the GitHub release, then verify pinned/unpinned Git install and removal in disposable profiles.
- The owner's daily local rc.6 trial remains unchanged until the public Git source is verified.

#### Comment by AllenYolk on 2026-09-05T18:47:53Z

## Release-candidate evidence — `7f69a46`

- Scope changed by owner to GitHub-only; npm publication is deferred.
- Pi 0.85.1: `npm run check` 40/40; bundled CLI, first paint, real InteractiveMode, lifecycle/GC and packed-artifact loading pass.
- Pi 0.85.0: the same working tree passes 40/40 with its undeclared `pi-server@0.85.0` added only to the test environment.
- GitHub Actions: 18/18 checks pass across Pi 0.85.0/0.85.1, Ubuntu/macOS and Node 22.19.0/24.12.0, plus current-version checks.
- Compatibility no longer depends on `Pi.VERSION`; required exports/descriptors and allowlisted presentation-method signatures remain fail-closed.
- `npm pack --dry-run --json`: exactly six intended files, 11,330 bytes packed / 32,012 bytes unpacked; no runtime dependencies, lifecycle scripts, generated output or bundled Pi.
- Pi 0.85.1 synthetic 320-call benchmark: compact 320/5,560 lines and 0.591/1.623 ms collapsed/expanded medians; no speed claim.
- Independent follow-up reviews: Standards 0 blockers; Spec 0 blockers.

Integration PR: pi-minimal-display#23. Remaining gates are merge, immutable `v0.1.0` tag/Release, and disposable-profile Git install/update/remove smoke tests.

#### Comment by AllenYolk on 2026-09-05T18:53:55Z

## Released

- Merged integration PR pi-minimal-display#23 to `main` at `77b6af75a68beec14d7ff6c3cc751bf8f44539df`.
- Main-branch CI passed all 9 jobs: Pi 0.85.0/0.85.1 × Ubuntu/macOS × Node 22/24, plus upstream version check.
- Annotated tag `v0.1.0` resolves to that exact merge commit; GitHub Release: https://github.com/AllenYolk/pi-minimal-display/releases/tag/v0.1.0
- Disposable pinned Git install resolved to the release commit, loaded the real bundled Pi CLI, grouped tools and reloaded twice; update retained the pinned ref; removal left no package.
- Disposable unpinned Git install resolved to `main`; `pi update --extensions` completed; removal left no package.
- npm was not used or published. The owner's daily local rc.6 trial was not modified.

Release acceptance is complete.

### pi-minimal-display#23 — Release v0.1.0

Pull request · closed · opened 2026-09-05T18:45:42Z by AllenYolk · closed 2026-09-05T18:48:18Z

## Summary
- ship the reviewed minimal/expanded Pi tool presentation
- install and update directly from GitHub; npm is intentionally deferred
- support tested Pi 0.85.0/0.85.1 presentation signatures without version-string lock-in
- publish only source, README, LICENSE and package metadata

## Validation
- Pi 0.85.0: 40/40 checks
- Pi 0.85.1: 40/40 checks
- exact six-file pack inspection
- independent Standards review: 0 blockers
- independent Spec review: 0 blockers

Closes pi-minimal-display#1
Closes pi-minimal-display#2
Closes pi-minimal-display#3
Closes pi-minimal-display#4
Closes pi-minimal-display#8
Closes pi-minimal-display#10
Closes pi-minimal-display#12
Closes pi-minimal-display#14
Closes pi-minimal-display#16
Closes pi-minimal-display#18
Closes pi-minimal-display#20
Closes pi-minimal-display#22

### pi-minimal-display#24 — Silence native thinking visibility notifications

Issue · closed · opened 2026-09-07T06:23:32Z by AllenYolk · closed 2026-09-07T07:06:31Z · labels: `ready-for-agent`

## Observable behavior

When Pi's native thinking-block visibility is toggled, the display changes and the native setting is persisted, but the transient `Thinking blocks: visible` / `Thinking blocks: hidden` status line must not be appended to the transcript. Existing unrelated status messages and tool expansion behavior remain unchanged.

## Acceptance criteria

- Suppress only the exact status emitted synchronously by native thinking visibility toggling.
- Preserve Pi's native thinking state, persistence, rendering, and repaint behavior.
- Preserve unrelated `showStatus` messages and the existing silent tool-expansion behavior.
- Restore all patched methods on disposal and keep unsupported-host fallback safe.
- Add a regression test at the presentation seam and pass the repository release checks.

#### Comment by AllenYolk on 2026-09-07T06:55:36Z

## Owner delivery authorization

On 2026-09-07, the owner explicitly authorized publishing this fix as GitHub release `v0.1.1` and public npm package `@allenyolk/pi-minimal-display@0.1.1`, after the repository checks and independent review pass.

#### Comment by AllenYolk on 2026-09-07T07:14:50Z

## Delivery evidence

- PR pi-minimal-display#25 merged to `main` at `f40712207a4426f16f080ac50b85cecbd5e071ba`.
- GitHub release `v0.1.1`: https://github.com/AllenYolk/pi-minimal-display/releases/tag/v0.1.1
- Public npm package `@allenyolk/pi-minimal-display@0.1.1`: https://www.npmjs.com/package/@allenyolk/pi-minimal-display/v/0.1.1
- `npm run check`: 41/41 on Pi 0.85.0 and Pi 0.85.1.
- `npm run benchmark`: passed on Pi 0.85.1.
- Package inspection: six approved files, source entry loads without bundled Pi runtime dependencies.
- Real-host Ctrl+T regression covers hidden/visible toggles, native persistence/rendering, unrelated status messages and failure restoration.

### pi-minimal-display#25 — fix: silence native thinking visibility status

Pull request · closed · opened 2026-09-07T07:01:01Z by AllenYolk · closed 2026-09-07T07:06:30Z

Closes pi-minimal-display#24

## Summary

- Silence only Pi's synchronous `Thinking blocks: visible/hidden` status emitted by the native thinking-visibility toggle.
- Preserve native thinking state, persistence, repaint, unrelated status messages, disposal, and fail-closed host compatibility.
- Add real-host and presentation-seam regression coverage; update the package to `0.1.1`.

## Validation

- `npm run check` — 41/41 on Pi 0.85.1
- `npm run check` — 41/41 on Pi 0.85.0 with its required `pi-server` validation dependency
- `npm run benchmark` — completed on Node 24.18.0 / Pi 0.85.1
- `npm pack --ignore-scripts --json` — six-file artifact, no lifecycle/runtime dependencies

The owner separately authorized the GitHub and public npm `v0.1.1` release after review.

### pi-minimal-display#26 — Accept Pi 0.99.1 as a tested host

Issue · closed · opened 2026-09-30T12:56:47Z by AllenYolk · closed 2026-09-30T14:30:53Z · labels: `ready-for-agent`

## Observable behavior

On Pi 0.99.1 the extension fails closed at session start with `Pi 0.99.1 presentation methods are incompatible; using native display`. After this change, Pi 0.99.1 activates the compact presentation with the same behavior as on Pi 0.85.x. No configuration, rendering or lifecycle behavior changes.

## Cause

Two of the seven fingerprinted presentation methods changed in Pi 0.99.x:

- Bundled CLI `AssistantMessageComponent.updateContent`: minifier rename only (`c2` → `c`).
- `InteractiveMode.showStatus`, in both the SDK and the bundled CLI: status lines now render through `ThemedText` and `lastStatusMessage`, so notices recolor after a theme change. The adapter only shadows this method during the two native toggle actions and forwards every other message.

The other five methods are byte-identical to the allowlisted Pi 0.85.1 signatures.

## Acceptance criteria

- Keep the fingerprint allowlist mechanism (ADR 0001). Add the Pi 0.99.1 SDK and bundled-CLI signatures only after the full real-host suite passes on that exact version; keep all existing signatures.
- Red: with development dependencies on Pi 0.99.1 and no new signatures, the suite fails at the fail-closed compatibility gate. Green: with the signatures it passes with no test assertion changes.
- `devDependencies` pin Pi/Tui 0.99.1 as the latest tested host. CI tested hosts: Pi 0.85.1 and 0.99.1 × Ubuntu/macOS × Node 22.19.0/24.12.0. Pi 0.85.0 leaves CI; its signature stays allowlisted.
- `npm run check` passes on Pi 0.99.1 and 0.85.1; `npm run benchmark` runs on Pi 0.99.1 as compatibility evidence, not a speed claim; the packed artifact keeps the six approved files.
- README, validation and publishing docs record the tested hosts, evidence and release.
- Release 0.1.2: GitHub tag `v0.1.2` and Release after merge. The owner runs `npm publish` and updates the daily profile.

## Out of scope

Changing the fingerprint mechanism, third-party extension warnings, and the owner's daily profile.

#### Comment by AllenYolk on 2026-09-30T14:14:21Z

## Release-candidate evidence — `2b552a0`

- **Owner decisions (2026-09-30):**
  - Keep the ADR 0001 fingerprint mechanism.
  - CI re-verifies Pi 0.85.1 and 0.99.1. Pi 0.85.0 leaves CI and keeps its signatures.
  - Version 0.1.2. The agent merges, tags and publishes the GitHub Release; the owner publishes npm and updates the daily profile.
  - Tests stay at the five existing seams, with no new test files.
- **Red:** with devDependencies on Pi/Tui 0.99.1 and the v0.1.1 allowlist, `npm run check` passes 8/41. All 33 failures are the fail-closed gate (`Pi 0.99.1 presentation methods are incompatible`).
- **Green:**
  - With the 0.99.1 SDK and bundled-CLI signatures, `npm run check` passes 41/41 on Pi 0.99.1 and on Pi 0.85.1 (macOS arm64, Node 24.18.0), with no test changes.
  - TypeScript 5.9.3 typechecks against the 0.99.1 declarations.
  - The Spec reviewer recomputed both signatures independently. The five allowlist strings did not change in the later review-fix commits.
- **CI:** push and pull_request runs on `62ca8e4` and `2b552a0` each pass 9/9 jobs. That is Pi 0.85.1/0.99.1 × Ubuntu/macOS × Node 22.19.0/24.12.0, plus upstream-version with no drift warning.
- **Benchmark** (synthetic 320 calls, same environment):
  - Both hosts render 320/5,560 compact lines.
  - Collapsed/expanded medians on 0.99.1: compact 0.377/0.340 ms, native 0.285/0.205 ms.
  - On 0.85.1: compact 0.426/1.298 ms, native 3.209/0.991 ms.
  - Not a speed claim.
- **Package:** `npm pack --dry-run --json --ignore-scripts` lists exactly the six approved files, with no lifecycle scripts or runtime dependencies. Pi packages remain `"*"` peers, as Pi 0.99's host-provided dependency rules require.
- **Independent review:**
  - The first pass on `46e24d5` found no code defects.
  - Its doc and wording findings are fixed in `62ca8e4` and `2b552a0`.
  - Follow-up reviews: Standards 0 blockers, Spec 0 blockers.
- **Known limits:**
  - Local runs cover only macOS arm64 / Node 24.18.0; CI covers the matrix.
  - CI no longer re-verifies Pi 0.85.0.
  - The system-theme probes do not check card colors.
  - No provider-driven or codemode/MCP runs; Windows is untested.
- **Rollback:** remove the installed source, or pin `v0.1.1` / `@allenyolk/pi-minimal-display@0.1.1`, then restart Pi. Incompatible hosts already fail closed to native display.

Integration PR: pi-minimal-display#27.

#### Comment by AllenYolk on 2026-09-30T14:20:15Z

## Delivery evidence (GitHub)

- PR pi-minimal-display#27 merged to `main` at `310e361692c13fbce154d18fbf4f056d04546ade`. Its tree is identical to the reviewed, CI-tested `2b552a0`.
- Main-branch CI on `310e361` passes 9/9 jobs: Pi 0.85.1/0.99.1 × Ubuntu/macOS × Node 22.19.0/24.12.0, plus upstream-version.
- Checks on the exact release commit (Pi 0.99.1, macOS arm64, Node 24.18.0):
  - `npm ci --ignore-scripts`, then `npm run check`: 41/41.
  - `npm run benchmark`: 320/5,560 compact lines.
  - `npm pack --dry-run --json --ignore-scripts`: six approved files, 11,856 bytes packed / 35,074 unpacked.
- Annotated tag `v0.1.2` points to `310e361`. GitHub Release: https://github.com/AllenYolk/pi-minimal-display/releases/tag/v0.1.2
- Disposable profiles with the global Pi 0.99.1:
  - Pinned `git:github.com/AllenYolk/pi-minimal-display@v0.1.2` and unpinned `git:github.com/AllenYolk/pi-minimal-display` both resolved to `310e361`.
  - The real CLI loaded the package through profile settings without the incompatibility diagnostic, grouped two calls and reloaded twice.
  - `pi update --extensions` kept the checkout.
  - `pi remove` left no package directory or settings entry.
- Owner steps, not done by the agent: publish `@allenyolk/pi-minimal-display@0.1.2` to npm and update the daily profile. Close this issue once npm publication is confirmed.

#### Comment by AllenYolk on 2026-09-30T14:30:52Z

## npm publication

- The owner published `@allenyolk/pi-minimal-display@0.1.2` (npm `latest`: 0.1.2) from the `v0.1.2` release commit.
- The owner's daily profile now runs 0.1.2, and the owner confirmed the compact display works on Pi 0.99.1.

Release acceptance is complete.

### pi-minimal-display#27 — fix: accept Pi 0.99.1 host signatures

Pull request · closed · opened 2026-09-30T13:43:53Z by AllenYolk · closed 2026-09-30T14:14:52Z

Closes pi-minimal-display#26

## Summary

- Accept Pi 0.99.1 by allowlisting its SDK and bundled-CLI presentation signatures. The fingerprint mechanism (ADR 0001) and runtime behavior are unchanged; existing signatures stay.
- Pin Pi/Tui 0.99.1 as the latest tested host. CI re-verifies Pi 0.85.1 and 0.99.1; Pi 0.85.0 leaves CI and keeps its allowlisted signatures.
- Record the evidence and prepare `0.1.2`.

## Validation

- Red: with devDependencies on Pi 0.99.1 and the v0.1.1 allowlist, `npm run check` passes 8/41. Every failure is the fail-closed gate (`Pi 0.99.1 presentation methods are incompatible`).
- Green: `npm run check` 41/41 on Pi 0.99.1 and on Pi 0.85.1 (macOS arm64, Node 24.18.0), with no test changes.
- `npm run benchmark` on both hosts: 320/5,560 compact lines. This is not a speed claim.
- `npm pack --dry-run --json --ignore-scripts`: six approved files, no lifecycle scripts or runtime dependencies.
- Two-axis review (Standards and Spec). The Spec reviewer independently recomputed both signatures. Neither axis found a code defect; the doc and wording findings are addressed in 62ca8e4.

The owner authorized the GitHub `v0.1.2` release and will publish npm from the release commit.

