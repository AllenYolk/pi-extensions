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

**Cascade**: Deleting a session together with its whole descendant subtree, within one
project's session directory. A session forked into another project keeps its own files.

**Active session**: The session the running Pi instance is writing to. It is never deleted,
neither when the picker cursor is on it nor when it sits below the node being cascaded; in the
second case it is held back and the rest still go.

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
