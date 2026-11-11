# Glossary

One vocabulary for every package in this repository. Use these terms in issues, code and
tests. This is the domain glossary, not an implementation spec.

## Shared

**Tested host**: An exact Pi version whose behavior has passed a package's own checks. Each
package certifies its own set; the sets are not shared.

**Compatible host**: A Pi runtime whose required exports and patched method signatures match a
tested host. Version text alone does not decide compatibility.

**Collection**: This repository installed as one Pi package, which declares both extension
entries. Distinct from installing a package from npm.

## Session deletion

**Descendant**: A session whose `parentSessionPath` chain reaches another session. Pi records
the same link for a subagent session and for one forked by hand, so the two are
indistinguishable. Sessions that pi-subagents keeps in `<session>/tasks/` are also descendants
of that session; their header names the parent's ID, so the directory decides the link.

**Cascade**: Deleting a session and its descendants from the session listing supplied by
the caller. `/delete` uses the current project's session directory; the picker plans against
its selected current/all listing. Apply the active-session rule for the relevant entrypoint.

**Active session**: The session the running Pi instance is writing to. Picker deletion keeps
it out of the targets, whether selected directly or present among descendants. The `/delete`
command instead deliberately schedules it for removal at process exit.

**Pending deletion**: Files chosen for deletion but removed at process exit, after the
session file's last write, so nothing recreates them on the way out.

## Tool presentation

**User turn**: Tool activity between two user-input boundaries in a transcript. Assistant
commentary and thinking within it do not start another user turn.

**Tool call**: One invocation with an identity, arguments, and eventual result. A display group
never merges executions.

**Display group**: A visual summary of consecutive opted-in tool calls within a user turn,
without intervening narrative or native output. One user turn can contain several display
groups; each retains its position in the conversation.

**Native mode**: Pi's existing presentation, including any registered tool renderer. The
extension does not compact this tool.

**Count-only mode**: A compact count and status with details available on expansion.

**Lines mode**: A compact command preview when ungrouped; a group member when grouping is
enabled.

**Retained detail**: The command, text blocks, images, structured details, and truncation
references available to Pi. It excludes content Pi has already discarded.

## Context compaction

**Summarizer**: the request that produces a compaction summary, with its own model and thinking
level. Distinct from the conversation model and the session's thinking level, both of which the
host would otherwise reuse.

**Preset**: a named selection of summarizer model, thinking level, text budget and reasoning
budget, switchable while a session runs. `fast`, `balanced` and `deep` are presets; `off` is the
absence of one and returns compaction to stock Pi.

**Text budget**: the absolute output ceiling for the summary text. An absolute token value, never
derived from the host's reserved-token setting.

**Reasoning budget**: the absolute output ceiling for the summarizer's reasoning. Separate from the
text budget because their sum, not either alone, is what bounds the request.

**Ceiling**: text budget plus reasoning budget. The total output a preset permits.

**Acceptance bound**: what one summarization request may hand back: text budget plus reasoning
budget. It is the number the request actually bounds — accepting less would leave a dead band in
which a response the provider was allowed to produce is refused anyway.

**Budget stop**: a response the provider cut at the output ceiling. The budget worked, so the summary
is incomplete by choice rather than by accident, and it is persisted. Distinct from every other
truncated response, which is refused.

**API class**: the shape a provider API gives the ceiling, which is what decides what the two budgets
mean there. `answer-budget` adds the reasoning budget on top of the text budget, so thinking is capped
and the text budget is the room guaranteed to remain; `single-pool` sends their sum as one ceiling the
reasoning phase draws from uncapped, so the text has no ceiling of its own; `no-ceiling` sends no
output ceiling at all, so neither budget can be enforced. An API not enumerated is treated as a
single pool.

**Kept window**: the most recent session entries a compaction retains verbatim. Its size is a target
the extension chooses, not the host's configured recent-token setting, and it trades directly
against the text budget for a fixed base context.

**Base context**: what a session occupies immediately after a compaction: the host's prompt and tool
declarations, the summary, and the kept window. The prompt and tool declarations are a constant the
extension cannot reduce.

**Growth per cycle**: the distance between the compaction trigger and the base context — the amount
of new work a session absorbs between compactions.

**Prune**: shrinking context by replacing an old tool result with a bounded placeholder, keeping the
originating tool call. No model call and no summary, so it is not a compaction.

**Prunable result**: a tool result whose information the agent can recover by re-running the tool.
Results of side-effecting or one-shot tools are not prunable; pruning one is information loss, not
compression.

**Placeholder**: the bounded text a pruned tool result is replaced with. It names the tool, digests
the arguments, states how much was omitted and keeps an excerpt. The originating tool call is
preserved, which is what makes the result recoverable by re-running it.

**Prune window**: the amount of recent tool-result context a prune protects, denominated in tokens
and measured backwards from the newest result. Everything older than the window is a candidate.

**Prune gate**: the test that decides whether a prune may run now. Either of two facts permits one:
the next request has nothing cached to read, or compaction is imminent. With neither, nothing is
pruned. Its reasons are `prefix-read-from-cache` and `prefix-just-written` (the next request would
read the cache, so a prune would pay for that prefill again), `nothing-cached` (there is nothing to
invalidate), `compaction-imminent` (the prefix is about to be destroyed, so invalidating it is free),
`cache-ttl-fallback` (no request reported usable usage and the last one is older than the fallback
lifetime), and `inside-fallback-ttl` and `no-request-observed` (nothing yet says what the next
request would read).

**Degradation**: handing compaction back to stock Pi after the extension's own attempt fails. Always
announced, never silent. A budget stop is not a degradation: the summary was bounded, which is what
the extension is for.

## Code and state ownership

Paths below are relative to `packages/` unless stated otherwise.

| Area | Owner | Boundary |
| --- | --- | --- |
| Delete command and pending deletion | `pi-delete/src/index.ts` | Registers `/delete`, collects the choice and deletes the targets at process exit. |
| Descendant traversal and picker target planning | `pi-delete/src/descendants.ts` | Derives targets from Pi session listings, handles cycles and excludes the active picker session. |
| File removal and failure reporting | `pi-delete/src/delete-sessions.ts` | Prefers `trash`, falls back to unlink and reports surviving files. |
| Session-picker patches | `pi-delete/src/selector-patch.ts` | Owns selector/header wrappers, native-shape checks and picker refresh after mutation. |
| Display activation and configuration | `pi-minimal-display/src/index.ts`, `pi-minimal-display/src/config.ts` | The entry owns the disposer/status; config is read from Pi's actual agent directory. |
| Display projection and private host access | `pi-minimal-display/src/presentation.ts` | Owns fingerprint checks and presentation/mouse/expansion wrappers; execution and saved data remain Pi-owned. |
| Compaction activation, configuration and the compaction hook | `pi-compaction/src/index.ts` | Registers `/compaction`, owns the inert-until-enabled switch, the slash-command surface and the `session_before_compact` hook that supplies a compaction or hands it back. |
| Summarizer budgets, API classification and the host seam | `pi-compaction/src/summarizer.ts` | Owns the two output budgets, the per-API classification, thinking-level clamping, the bounded stream function, the acceptance bound and the activation-time host-seam check. |
| The cut point and the summarised range | `pi-compaction/src/preparation.ts` | Chooses the kept-window boundary and builds the range to summarise from the branch entries, so nothing between the two is lost. |
| Pruning, its gates and the never-prune list | `pi-compaction/src/prune.ts` | Owns the durable context-edit replacements, the bounded placeholder, the cache and imminence gates and the never-prune list. |
| The degradation announcement | `pi-compaction/src/degradation.ts` | Owns the failure wording, the announcement and the durable record of a degradation. |
| Collection/package boundaries | Repository-root manifest, `test/` and `.github/workflows/` | Aggregate installation, independent-package checks, coexistence and shared development/release tooling. |

Pi session records and parent links are the source of ancestry; the plugins do not maintain
a separate persistent session index. Pi also owns the compaction trigger, the summarization
prompts and the session's own reserved-token and recent-token settings; this repository's
compaction package chooses a summarizer, its budgets and a cut point, and hands compaction
back to Pi whenever it cannot bound the result. Pi also owns thinking visibility, global tool expansion
and tool results; compact cards are a projection of that state.

The display entry passes the host modules into its adapter so patched components are the
ones the CLI is using. A bundled host copy or a direct built-ESM load can create a second set
of classes and bypass that ownership boundary.
