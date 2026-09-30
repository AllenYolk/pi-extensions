# Specification review

Status: Review direction approved by the owner on 2026-09-05. The authoritative implementation contract is the GitHub spec issue. Issue #24 additionally requires Pi's native thinking-visibility toggle status to be silent, with the same action-scoped semantics as issue #16. Issue #26 accepts Pi 0.99.1 by allowlisting its tested signatures under the unchanged ADR 0001 mechanism; the owner narrowed CI tested hosts to Pi 0.85.1 and 0.99.1 and authorized GitHub `v0.1.2`, with npm publication performed by the owner.

The owner selected [silent native expansion (#16)](https://github.com/AllenYolk/pi-minimal-display/issues/16): preserve Pi's native two-state setter and repaint, but suppress only the exact mode notification emitted synchronously by that action. Do not route it to Starship or globally filter matching transcript text. [Issue #24](https://github.com/AllenYolk/pi-minimal-display/issues/24) applies the same rule to native thinking-visibility toggles.

The owner subsequently removed the plugin-owned thinking switch: Pi's native `hideThinkingBlock` is the single visibility authority. [Issue #20](https://github.com/AllenYolk/pi-minimal-display/issues/20) further requires the compact projection to omit Pi's hidden-thinking placeholder and cross hidden-only thinking components, while visible thinking and assistant text remain boundaries. The owner later authorized publishing this #24 fix as both GitHub `v0.1.1` and the public npm package.

Issue #18 removes the plugin `hideThinking` field. Issue #20 supersedes its prohibition on Assistant presentation adaptation: the adapter may filter only when the component's native `hideThinkingBlock` state says thinking is hidden, and must restore native presentation on disposal. A legacy plugin boolean may be accepted and ignored during migration, but cannot affect rendering.

The approved [native-card/automatic-mode plan (#14)](https://github.com/AllenYolk/pi-minimal-display/issues/14) changes ordinary-tool defaults to count-only and retains exact native exclusions for known interactive tools. Summaries use native theme/padding and two lines; native global expansion is the only mode state. Entering sessions starts minimal, while reload preserves global expansion. No command is required for first paint.

Owner trial feedback supersedes whole-turn grouping in [issue #10](https://github.com/AllenYolk/pi-minimal-display/issues/10): only consecutive managed calls form a group; intervening text/thinking, native tools and other output keep their original positions. Empty assistant tool-call placeholders may be crossed. The owner subsequently approved [issue #12](https://github.com/AllenYolk/pi-minimal-display/issues/12): remove the Retained data appendix and use native expansion only, preserving raw session/model data without adding a second raw-data UI.

## Starting point

This project follows the Pi Minimal Display handoff prepared on 2026-09-05. The GitHub repository is AllenYolk/pi-minimal-display. The owner selected MIT and the v0.1.0 initial release was GitHub-only; for the current #24 delivery, the owner additionally authorized public npm publication of v0.1.1.

Primary references:

- [Pi extension documentation](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/extensions.md)
- [Pi tool presentation](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/src/modes/interactive/components/tool-execution.ts)
- [Pi transcript construction](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/src/modes/interactive/interactive-mode.ts)
- [compact-display 1.3.0](https://github.com/Masterisk-F/pi-compact-display/tree/v1.3.0)

The previous handoff is input to this review, not proof that its architecture or compatibility claims have been validated.

## Proposed corrections to the handoff

1. **Group membership must be unambiguous.** Proposed behavior: with grouping enabled, both `count_only` and `lines` tools contribute to the same turn header. `native` tools remain outside it. With grouping disabled, `count_only` produces an individually expandable summary; `lines` produces a compact call preview. No hidden tool becomes impossible to inspect.
2. **Expanded content follows native presentation.** Per issue #12, expanded tool output must match Pi's native renderer rather than duplicate raw data in an appendix. Original arguments, result blocks and structured details remain unchanged in session/model data, including when native renderers omit successful text or metadata. Images and controls stay native; output the host discarded cannot be recovered.
3. **Display summaries stay out of message data.** Do not inject summaries into assistant messages and then remove them by matching an emoji prefix. Session serialization, model context, tool definitions, and execution results must remain unchanged.
4. **Transcript structure is the authority.** Pi 0.85.0 inserts some entries using `chatContainer.children.splice(...)`, bypassing `addChild`. A separate mirror based only on container methods is incomplete. The first technical investigation must establish a reliable presentation seam for live updates, replay, queued input, skill invocation, fork, and reload.
5. **Compatibility follows the patched seam, not version text.** Record exact tested Pi versions, but activate when the required exports and patched method signatures match a tested host. This lets unrelated Pi releases continue working without weakening safe native fallback when the presentation seam changes. Wildcard Pi peer ranges are loader metadata, not proof of runtime compatibility.
6. **Patch ownership needs a teardown protocol.** Each runtime instance owns its installed wrappers. Installation is atomic: validate before changing methods and roll back a partial failure. Disposing an older instance must not overwrite another extension's later wrapper. After disposal, stale wrappers must no longer suppress content or retain session state.
7. **Errors are visible without relying only on color.** A collapsed card must identify a failed operation in text and retain an expansion path. Pending work must not mask an already failed member. Cancellation and rejected execution need defined terminal states.
8. **Thinking visibility is native-only.** Use Pi's supported `hideThinkingBlock` setting. This plugin must not expose a duplicate visibility option or rewrite session/model content. Its compact projection omits the native hidden placeholder and crosses hidden-only thinking; visible thinking remains a boundary.
9. **Open-source provenance requires a decision.** compact-display declares ISC in package metadata but includes a GPL-3.0 LICENSE. Record this mismatch before any code reuse. Plan an original implementation; any copied source needs an explicit provenance/license review before distribution.

## Proposed engineering gates

| Gate | Required evidence | Exit criterion |
| --- | --- | --- |
| Setup | Confirmed tracker, label vocabulary, and agent-document choice | Setup documents approved and written |
| Spec | Resolved behaviors above and mapped acceptance cases | No contradictory grouping, expansion, or failure contracts |
| Host seam | Tests through the real Pi loader and components | Live/replay, teardown, and unsupported-version fallback demonstrated |
| Implementation | Focused change per issue and regression tests | Tool execution and model/session payloads unchanged |
| Review | Correctness, lifecycle, and dependency review | No unresolved release-blocking findings |
| Packaging | Actual tarball load in a disposable Pi profile | Entrypoints, files, license, and lifecycle scripts verified |
| Release candidate | Reproducible checks and documented supported versions | Artifacts ready for owner approval; publication is separate |

## Test scope

Prioritize real Pi integration over tests that invoke mocked event handlers alone. Include at least: tool identity and execution delegation, mixed-tool grouping, count-only expansion, native passthrough, multiline/Unicode commands, all retained result blocks, diff details, errors/cancellation, narrow terminals, live streaming, restored sessions, configuration errors, repeated reload, and unknown-version fallback.

Measure collapsed and expanded rendering on a long recorded transcript against the same host without the extension. Do not claim performance improvements from code size or a smoke test. Keep test fixtures and logs inside the project; never patch an installed Pi or alter the user's live extension profile as part of validation.

## Current evidence and limitations

- A read-only check of the installed Pi 0.85.0 code confirms direct transcript-array insertion and an `updateContent(message, isStreaming)` argument that wrappers must preserve.
- Earlier compact-display component probes demonstrated grouping with a supplied renderer definition, a reload configuration leak, and a default-mode read visibility mismatch. These are research observations, not release certification for this project.
- Engineering setup created the public repository and its triage labels. It did not activate a plugin in the owner's live profile or publish an npm release.
