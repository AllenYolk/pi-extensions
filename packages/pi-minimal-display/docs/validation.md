# Validation

Current release: `0.2.1`. Adds completed-failure cards with local failure counts and render-time model-request event folding. The display package's development host is Pi 1.1.0, so CI re-verifies that host; the same change also passed the package check on Pi 0.99.1 before the host pin moved. Thinking display follows Pi's native `hideThinkingBlock` setting; the plugin has no corresponding setting. Older evidence below is historical.

## Pi 0.99.1 host

Issue pi-minimal-display#26 adds Pi 0.99.1 as a tested host without changing the fingerprint mechanism or runtime behavior. The v0.1.1 adapter failed closed on Pi 0.99.1 because two fingerprints changed: the bundled `AssistantMessageComponent.updateContent` only by a minifier rename, and `InteractiveMode.showStatus` in both the SDK and the bundle, which now renders through `ThemedText` so notices recolor after theme changes. The adapter only shadows `showStatus` during the two native toggle actions; the other five methods are byte-identical to the Pi 0.85.1 signatures.

With development dependencies on Pi/Tui 0.99.1 and the v0.1.1 allowlist, `npm run check` passed only 8/41, and every failure was the fail-closed gate. With the 0.99.1 SDK and bundled-CLI signatures it passes 41/41 on Pi 0.99.1 and on Pi 0.85.1 without test changes, on macOS arm64 and Node 24.18.0. Pi 0.99.1 needs no extra test-only package, and the packed artifact still contains only the six approved files. The CLI reload and packaged-artifact probes run under Pi 0.99's default `system` theme but do not check card colors; color coverage remains the component-level dark/light tests. On the synthetic 320-call benchmark in that environment, both hosts render 320/5,560 compact collapsed/expanded lines. Collapsed/expanded medians are 0.377/0.340 ms compact and 0.285/0.205 ms native on Pi 0.99.1, versus 0.426/1.298 ms compact and 3.209/0.991 ms native on Pi 0.85.1. Pi's native rendering changed between the hosts, so these numbers support no plugin speed claim.

## Host compatibility

The release candidate removes the exact-version gate. It still requires the tested exports, writable descriptors and complete presentation-method signature; incompatible hosts fail closed to native display. This avoids a plugin release for Pi changes outside the patched seam. Pi 0.85.1 changed its bundled Assistant/status fingerprints, so that bundle received a separate allowlisted signature only after the full real-CLI suite passed; the unbundled presentation seam remained compatible. Pi core imports are `"*"` peers per Pi's package guidance, while development dependencies pin the latest tested host.

On macOS arm64 and Node 24.12.0, all 40 checks pass against Pi 0.85.1. The same release working tree also passes 40/40 after installing Pi/Tui 0.85.0 plus its development-only undeclared `pi-server` import without changing the lockfile; the release package does not ship or require that workaround. `npm ci` then restores the locked 0.85.1 host. The 0.85.1 synthetic 320-call benchmark renders 320/5,560 compact lines with 0.609/1.646 ms collapsed/expanded medians; this is compatibility evidence, not a speed claim. CI runs both hosts across macOS/Ubuntu and Node 22/24.

## Native thinking visibility

Rollout diagnosis confirmed that MiniMax-M3 is reasoning-capable and the latest local spikingjelly-v2 rollout contains non-empty `thinking` blocks. The prior apparent conflict came from rc.4's plugin-level `hideThinking` default overriding Pi's native `hideThinkingBlock: false`. Issue pi-minimal-display#18 removed that field; issue pi-minimal-display#20 now uses only the native Assistant component state to omit its hidden placeholder. Hidden-only thinking no longer splits adjacent managed tools, while visible thinking and assistant text remain boundaries.

For migration, an old boolean `hideThinking` key is validated and ignored rather than copied into the new runtime config; it no longer controls rendering.

40 local checks pass. The rc.6 regression covers hidden-only merging, mixed hidden-thinking/visible-text ordering, runtime native visibility changes, existing components, streaming and disposal restoration. The adapter patches tested Assistant update/render methods but adds no visibility state and never changes session/model content. On the same synthetic 320-call workload, rc.5 → rc.6 compact medians were 0.854 → 0.704 ms collapsed and 1.855 → 2.091 ms expanded; displayed lines remained 320/5,560. These sub-millisecond run-to-run differences do not support a performance claim.

## Silent native expansion

The adapter keeps Pi's certified `setToolsExpanded` implementation and temporarily routes only its exact synchronous `Tool output: expanded/collapsed` call away from `showStatus`, then requests the render that notification previously triggered. It restores any instance-local status method in `finally`; other statuses during the action and identical status text outside it remain visible. The setter wrapper is fingerprint-gated, owner-aware, reversible and inert after disposal. There is no transcript string filter, key interception, Starship coupling, timer or new setting.

## Silent native thinking visibility

Issue pi-minimal-display#24 applies the same action-scoped status routing to Pi's native `toggleThinkingBlockVisibility` method. Native state changes, persistence and repaint remain authoritative; only the exact synchronous `Thinking blocks: hidden/visible` status is suppressed. Status text emitted outside the toggle and unrelated status calls remain visible. The added regression covers both directions and the failure path that restores the original status method.

For pi-minimal-display#24, `npm run check` passed 41/41 on Pi 0.85.0 and Pi 0.85.1, including real host Ctrl+T toggles in both directions; `npm run benchmark` passed on Pi 0.85.1. The npm 0.1.1 tarball contains only the six approved package files and loads its source entry without bundled Pi runtime dependencies.

38 local checks pass. Real Ctrl+O/custom Ctrl+G and ten CLI reloads toggle/repaint without either mode line. A later same-turn ReadSeek call remains in the adjacent group, proving the removed line no longer creates a boundary. Failure restoration, preexisting/later wrappers, first paint, package loading, images, native expansion and session/UI GC remain covered. The same public 391-call benchmark renders 2,983/14,889 collapsed/expanded lines; local native → plugin medians were 2.749 → 1.928 ms collapsed and 3.659 → 4.123 ms expanded. The toggle path is not part of this render-only benchmark, so no performance claim follows. Exact independent review, CI and deployment evidence is recorded in issue pi-minimal-display#16 before promotion.

## Native cards and automatic minimal

37 local checks pass. Fresh and resumed bundled-CLI sessions in regular/fullscreen show all six fixture tool counts (including ReadSeek and an unknown tool) before any command or key input; the PTY sends only exit after observing the complete minimal summary. A negative control using rc.2 fails because native raw tool output appears. Fresh UI events are deterministic test injection through the real InteractiveMode initial-render lifecycle, not a provider/model run.

Real-host checks cover Ctrl+O and a custom Ctrl+G binding, native image/control preservation, and ordered groups. Actual CLI reloads alternate global expansion and preserve it. Entry lifecycle tests cover startup/new/resume/fork reset, reload preservation, status-only queries, conflict refusal and rollback if the native transition fails. Render tests cover dark/light themes, failure-over-pending precedence, native padding, 20-column wrapping, colored-padding clicks and non-clickable gaps. The GC probe includes a UI getter retaining the session and confirms disposal releases it.

The same public 391-call workload renders 2,983 collapsed lines (rc.2: 2,135) and 14,889 expanded lines (unchanged). The additional 848 lines are the approved card spacing and second summary line. Local native → plugin medians: collapsed 2.462 → 1.939 ms; expanded 3.735 → 3.653 ms. These measurements do not imply a speedup over rc.2; native card styling deliberately costs more space/work. Full CI, independent review and exact deployment evidence are recorded in issue pi-minimal-display#14 before promotion.

## Native-expansion trial update

The rc.2 implementation includes ordering fix pi-minimal-display#10 and removes the raw appendix plus its serialized-layout cache per pi-minimal-display#12. Ctrl+O uses native renderers without changing original arguments/results/details. The write-renderer regression compares complete expanded output against native output, not merely absence of a heading; session/model and native image/control checks remain.

27 local checks pass, including real host ordering and CLI/tarball loading. The public 914-message/391-call fixture renders 2,135 collapsed lines and 14,889 expanded lines; the earlier ordered appendix version rendered 24,802 expanded lines. Local native → plugin medians: collapsed 2.726 → 0.686 ms; expanded 3.759 → 3.497 ms. These are workload-specific measurements, not a general speed guarantee. Exact reviewed/deployed commit, CI and uninstall evidence are tracked in issue pi-minimal-display#12.

## Ponytail follow-up

[pi-minimal-display#8](../../../docs/archive/pi-minimal-display.md) replaces the internal installation result object/flag/no-op implementation and separate owner token with one optional disposer. It removes dead startup cleanup and a redundant collapsed-click condition. Public behavior and necessary boundary checks remain unchanged; production source shrinks by 13 lines without new dependencies.

All 24 checks pass. Against `a65066a`, five alternating before/after trials of the public recorded fixture produced byte-identical folded/expanded output (1,996/24,802 lines). Median-of-medians: folded 0.478 → 0.581 ms, expanded 4.713 → 5.047 ms. These timings do not establish a speedup; this change targets simpler ownership. Follow-up independent review and CI evidence are tracked in issue pi-minimal-display#8; the reviews below refer to the baseline, not automatically to later commits.

## Standards

Subsequent owner feedback in [pi-minimal-display#10](../../../docs/archive/pi-minimal-display.md) corrects the original whole-turn grouping requirement: tools must not move across narrative/native output. The ordering fix has 26 passing checks, including real host event construction and expanded/collapsed relative-order assertions. Five alternating trials against `a158d7d` retain identical native output; corrected compact output intentionally changes order. Public recorded-session medians: collapsed 0.515 → 0.730 ms (1,996 → 2,135 lines), expanded 4.942 → 5.258 ms (24,802 lines). More headers are the cost of preserving order; no speedup is claimed. The installed trial snapshot and Retained data appendix are unchanged. This follow-up is not covered by the historical baseline reviews below.

No remaining release blockers or actionable heuristic smells. The independent reviewer reran all 24 checks and the public recorded-session benchmark. Prior gaps in real-host integration and recorded-transcript evidence are closed. The adapter's private host access remains confined to the explicitly approved presentation boundary.

## Spec

No remaining release-blocking findings against issue pi-minimal-display#1. Earlier thinking restoration, native controls, retained data, streaming expansion, image-only boundaries, RPC/conflict, disposal and host-evidence findings are closed with regressions. This reviewer independently inspected pinned CI and reran the recorded benchmark; local file-writing host/package probes were not rerun by that reviewer.

Summary: Standards 0 unresolved findings; Spec 0 unresolved findings. Independent reviews are evidence, not a guarantee that every environment is covered.

## Local evidence

On macOS arm64, Node 24.12.0 and Pi 0.85.0, 24 checks passed after building/type checking:

- Profile defaults, exact overrides, malformed configuration and native fallback.
- Real Pi component rendering, user/skill boundaries, direct transcript-array edits, pending+failed summaries, native recovery, narrow commands and mouse expansion.
- Repeated install/dispose with native thinking visibility and preservation of original streaming/message data.
- Real bundled Pi CLI in a PTY executing a fixed `printf` fixture, rendering a group and reloading ten times while alternating native expansion state.
- Actual npm tarball inspection and isolated installation with peer auto-install disabled, followed by real CLI loading and two reloads.
- Review regressions: image-only user turns, native thinking visibility, newly arriving expanded members, native result rendering, RPC inactivity, prior prototype conflicts, and native renderer buttons.
- Disposed sessions are garbage-collectible even when another extension retains a wrapper; stale mouse wrappers are inert, and session-projection faults report once and recover native rendering.
- Real InteractiveMode with an isolated runtime: saved JSONL reopening and replay, branch/fork persistence and transcript rebuilding, editor Ctrl+O dispatch, mouse group expansion/collapse, follow-up queue presentation and non-consumption, synthetic streaming/partial/failure/abort events, and byte-identical native/expanded iTerm2 PNG payloads. Rendering and expansion preserve session/model snapshots.

The loader test initially failed with a built ESM entry inside the development tree, which resolved a different host class instance. The shipped source entry runs through Pi's extension loader; the adapter receives the host module objects from that entry.

These probes do not use an LLM. The InteractiveMode probe invokes real host methods without starting its terminal/provider loop; its streaming events are deterministic fixtures. The separate PTY probe exercises actual terminal startup and reload. Together they do not certify provider-driven queue delivery, the interactive `/fork` selector, physical terminal image display, or every terminal/image protocol.

## Synthetic rendering measurement

Same process/host, 40 user turns, 8 bash calls per turn, 12 retained output lines per call, width 100. The populated SessionManager has 680 branch entries, so the extension measurement includes the production branch traversal and tool-to-turn mapping. Two warmups and seven measured renders; medians below. The fixture contains no user session data.

| View | Native lines | Compact lines | Native median | Compact median |
| --- | ---: | ---: | ---: | ---: |
| Collapsed | 3,640 | 160 | 4.455 ms | 0.787 ms |
| Expanded | 5,560 | 9,080 | 1.463 ms | 1.794 ms |

Expanded output includes an additional retained-data appendix so that successful result blocks hidden by native renderers remain inspectable. Its first implementation rebuilt text layout every frame (15.873 ms median); caching by serialized content reduced that cost. The cache is weakly keyed by tool component, detects in-place content changes, and is discarded on disposal.

These numbers describe this synthetic workload only. Reproduce with `npm run benchmark`; do not infer tool-execution, model-latency or real-session performance from them.

## Public recorded-session measurement

Source: Pi's [large-session.jsonl at v0.85.0](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/test/fixtures/large-session.jsonl), a public recorded session dated 2025-11-20. SHA-256: `f029e59c3aec82fd6227eae51fc8839862a92b5e2426731ea9715eaf968a0ba4`. No private owner session was read. The fixture is downloaded into ignored work space, not redistributed in the package.

The benchmark imports its 914 message entries into an in-memory session and constructs real user/assistant/tool components, without executing recorded commands or migrating the source file. It includes 88 user messages and 391 tool calls (bash/read/edit/write). This is a component-level rendering benchmark, distinct from the InteractiveMode replay check above. Same Node/Pi/platform, width, warmups and samples as the synthetic measurement; the fixture uses Pi's native thinking visibility.

| View | Native lines | Compact lines | Native median | Compact median |
| --- | ---: | ---: | ---: | ---: |
| Collapsed | 7,502 | 1,996 | 2.326 ms | 0.623 ms |
| Expanded | 14,892 | 24,802 | 3.546 ms | 4.655 ms |

Expanded rendering is slower and longer because the appendix exposes retained arguments/text/details in addition to native output. The benchmark does not establish a universal speedup.

To reproduce after `npm ci --ignore-scripts`:

```sh
mkdir -p work
curl --fail --location https://raw.githubusercontent.com/earendil-works/pi/v0.85.0/packages/coding-agent/test/fixtures/large-session.jsonl --output work/upstream-large-session.jsonl
shasum -a 256 work/upstream-large-session.jsonl
npm run benchmark -- work/upstream-large-session.jsonl
```

## Certification limits

Pi 0.85.0, 0.85.1 and 0.99.1 are historically tested hosts; CI now re-verifies only the latest tested host, 0.99.1. A future Pi version is accepted only while its presentation seam matches an allowlisted tested signature; matching is compatibility evidence, not full release certification. The historical four-job CI matrix (retired-repository run 33959587401) passed on Linux/macOS with Node 22.19.0/24.12.0 at commit `bc3c8b2`; the Pi 0.99.1 release evidence is recorded in issue pi-minimal-display#26. Windows and alternative Pi runtimes are not tested by this candidate.
