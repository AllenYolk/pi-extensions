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

**Batch mode**: An in-place view of the session picker for marking and deleting multiple sessions.

**Selection**: The set of listed sessions marked for bulk deletion, distinct from the row under
the cursor. The active session cannot be marked.

**Bulk deletion**: Removing the selection and its owned hidden task transcripts in one
confirmation. Unmarked visible forks keep their files and tasks.

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

**Summarizer**: the request that produces a compaction summary, with its own model and thinking level.
Distinct from the conversation model and the session's thinking level, both of which the host would
otherwise reuse.

**Kept window**: the most recent session entries a compaction retains verbatim. Its size is a target
the extension chooses, not the host's configured recent-token setting.

**Base context**: what a session occupies immediately after a compaction: the host's prompt and tool
declarations, the summary, and the kept window. The prompt and tool declarations are a constant the
extension cannot reduce.

**Growth per cycle**: the distance between the compaction trigger and the base context — the amount
of new work a session absorbs between compactions.

**Whole summary**: a summary the summarizer finished. Distinct from a partial one, which the host
returns unchanged for a stop reason it does not itself reject. A partial summary is never persisted,
and a whole one is never shortened: the extension sends no output ceiling, so the summary is as long as
the host's prompt and the model make it.

**Re-distillation**: asking the summarizer to merge the previous summary towards a fixed point rather
than only adding to it. It is a request, carried in the host's own custom-instruction slot, and it
bounds nothing: a model that ignores it produces the summary it produces today. Off unless configured,
never asked for on a split turn, and unvalidated.

**Degradation**: handing compaction back to stock Pi after the extension's own attempt fails. Always
announced, never silent. It gives up the summarizer model and its thinking level — the whole of what
the extension controls — and changes nothing about the summary's length.

**Fallback summarizer**: the one model a compaction tries after the configured summarizer fails, and
before it hands back. Optional, single, and never the conversation model: the handback already is
that. It runs at the primary's thinking level and over the primary's cut point, and the whole-summary
guarantee applies to it unchanged. Only a failed attempt reaches it — a cancellation, a host seam
mismatch, a cut point with nothing to summarise and a rejected configuration all end the compaction
where they are.

**Attempt**: one summarizer a compaction tried, in the order it tried them. The last attempt ran
unless it carries a reason, which is how one record shape distinguishes a handback from a successful
fallback.

## Code and state ownership

Paths below are relative to `packages/` unless stated otherwise.

| Area | Owner | Boundary |
| --- | --- | --- |
| Delete command and pending deletion | `pi-delete/src/index.ts` | Registers `/delete`, collects the choice and deletes the targets at process exit. |
| Descendant traversal and picker target planning | `pi-delete/src/descendants.ts` | Derives targets from Pi session listings, handles cycles and excludes the active picker session. |
| File removal and failure reporting | `pi-delete/src/delete-sessions.ts` | Prefers `trash`, falls back to unlink and reports surviving files. |
| Session-picker patches | `pi-delete/src/selector-patch.ts` | Owns selector/header wrappers, native-shape checks and picker refresh after mutation. |
| Batch selection and cursor | `pi-delete/src/batch-selection.ts` | Tracks marked paths and the cursor over the rows supplied by the picker. |
| Batch view | `pi-delete/src/batch-view.ts` | Owns Batch keys, rendering, confirmation and the bulk-delete interaction. |
| Display activation and configuration | `pi-minimal-display/src/index.ts`, `pi-minimal-display/src/config.ts` | The entry owns the disposer/status; config is read from Pi's actual agent directory. |
| Display projection and private host access | `pi-minimal-display/src/presentation.ts` | Owns fingerprint checks and presentation/mouse/expansion wrappers; execution and saved data remain Pi-owned. |
| Compaction activation, configuration and the compaction hook | `pi-compaction/src/index.ts` | Registers `/compaction`, owns the inert-until-enabled switch, the slash-command surface and the `session_before_compact` hook that supplies a compaction or hands it back. |
| The cut point and the summarised range | `pi-compaction/src/preparation.ts` | Chooses the kept-window boundary and builds the range to summarise from the branch entries, so nothing between the two is lost. |
| The summarizer model, its thinking level and the host seam | `pi-compaction/src/summarizer.ts` | Resolves a summarizer model, clamps its thinking level to what the model supports, owns the observing stream function the stop-reason read goes through, and owns the activation-time host-seam check. |
| The re-distillation request | `pi-compaction/src/redistill.ts` | Owns the fixed instruction template, decides when it applies (previous summary's size, configured thresholds, not a split turn), owns the activation-time probe of the host's token estimate that gates it, and the `/compaction` line that reports it. Returns the custom-instruction value; it never touches the response. |
| The attempt sequence and its record | `pi-compaction/src/degradation.ts` | Owns the failure wording, the announcement, the durable record of a handback and of a successful fallback, and the entry type each is written as. |
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
