# Glossary

One vocabulary for both packages in this repository. Use these terms in issues, code and
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
indistinguishable.

**Cascade**: Deleting a session and its descendants from the session listing supplied by
the caller. `/delete` uses the current project's session directory; the picker plans against
its selected current/all listing. Apply the active-session rule for the relevant entrypoint.

**Active session**: The session the running Pi instance is writing to. Picker deletion keeps
it out of the targets, whether selected directly or present among descendants. The `/delete`
command instead deliberately schedules it for removal during session shutdown.

**Pending deletion**: Files chosen for deletion but removed during Pi's shutdown, after the
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

## Code and state ownership

Paths below are relative to `packages/` unless stated otherwise.

| Area | Owner | Boundary |
| --- | --- | --- |
| Delete command and pending shutdown targets | `pi-delete/src/index.ts` | Registers `/delete`, collects the choice and applies queued deletion during shutdown. |
| Descendant traversal and picker target planning | `pi-delete/src/descendants.ts` | Derives targets from Pi session listings, handles cycles and excludes the active picker session. |
| File removal and failure reporting | `pi-delete/src/delete-sessions.ts` | Prefers `trash`, falls back to unlink and reports surviving files. |
| Session-picker patches | `pi-delete/src/selector-patch.ts` | Owns selector/header wrappers, native-shape checks and picker refresh after mutation. |
| Display activation and configuration | `pi-minimal-display/src/index.ts`, `pi-minimal-display/src/config.ts` | The entry owns the disposer/status; config is read from Pi's actual agent directory. |
| Display projection and private host access | `pi-minimal-display/src/presentation.ts` | Owns fingerprint checks and presentation/mouse/expansion wrappers; execution and saved data remain Pi-owned. |
| Collection/package boundaries | Repository-root manifest, `test/` and `.github/workflows/` | Aggregate installation, independent-package checks, coexistence and shared development/release tooling. |

Pi session records and parent links are the source of ancestry; the plugins do not maintain
a separate persistent session index. Pi also owns thinking visibility, global tool expansion
and tool results; compact cards are a projection of that state.

The display entry passes the host modules into its adapter so patched components are the
ones the CLI is using. A bundled host copy or a direct built-ESM load can create a second set
of classes and bypass that ownership boundary.
