# @allenyolk/pi-delete

`/delete` removes the current Pi session and exits, the way codex CLI's `/delete` does. Sessions that were forked or spawned from it can go with it.

```text
 Delete session and exit?

 → Delete current session
   Cancel
```

When the session has descendants, the prompt grows a cascade option and the list of what it would take:

```text
 Delete session and exit?

 Cascade also removes:
   subagent B · 2 msgs
   subagent A · 2 msgs
     nested subagent under A · 2 msgs

 → Delete current session
   Delete current + 3 descendants
   Cancel
```

One prompt, no second confirmation. The listing sits above the choices because a count alone hides *which* sessions would go; once that is visible, asking twice adds nothing. The safe option is highlighted, and the cascade takes a deliberate move down to reach.

The cascade is what this exists for: a run that spawns five subagents leaves five session files behind, and deleting them one at a time through the picker is the tedium worth removing.

Sessions are identified by name or opening message, the way Pi's own picker does it, and indented by depth. A session you have named shows as `[named] <name>`, so deliberate work stands out. Pi cannot tell a subagent session apart from one you forked by hand — both record the same `parentSession` link — so read the list rather than trusting the count.

## Not the same as `pi-delete`

There is an unscoped [`pi-delete`](https://github.com/leeskies/pi-delete) by another author. Both register `/delete`; do not install both.

|  | `@allenyolk/pi-delete` (this) | `pi-delete` (leeskies) |
| --- | --- | --- |
| Delete current session | exits Pi | starts a fresh session |
| Cascade to descendants | yes | no |
| Delete another session by ID | no | yes, plus `pi --delete <id>` |
| No trash command available | falls back to permanent delete | refuses to delete |

Pick theirs for targeting sessions by ID from the CLI. Pick this one for the codex-style quit-and-delete, or to clear a subagent tree in one confirmation.

## In the session picker

`/resume` already deletes one session with `ctrl+d`, then `enter` to confirm. This adds a second answer to that same question: **`t`** deletes the highlighted session together with everything below it.

```text
› main session                                              2 now
     ├─ subagent B                                          2 now
     └─ subagent A                                          2 now
        └─ nested subagent under A                          2 now

Delete session? enter confirm · escape/ctrl+c cancel · t subtree
```

`ctrl+d` then `enter` still removes exactly one session; `ctrl+d` then `t` removes the subtree. The list updates in place, so there is no need to close and reopen the picker.

No new top-level keybinding is introduced, and `t` is unambiguous because the picker ignores every other key while its confirmation is up — outside that state `t` goes to the search box as usual. It also needs no kitty keyboard protocol, so it behaves the same in every terminal.

The subtree is already drawn in the list, so the prompt does not repeat the names.

The active session is never deleted — not when the cursor is on it, and not when it sits somewhere below the node being cascaded; in that case it is held back and the rest still go.

This is not available in the picker that `pi --resume` opens at startup. That picker runs and returns before extensions are loaded (`createSessionManager` precedes `createAgentSessionServices` in Pi's startup), so no extension can reach it. Resume into a session first, then use `/resume`.

## Install

```sh
pi install npm:@allenyolk/pi-delete
```

Or take it from the [pi-extensions collection](../../README.md#install), which also enables
`@allenyolk/pi-minimal-display` unless you narrow it with a resource filter:

```sh
pi install git:github.com/AllenYolk/pi-extensions
```

Or from a checkout, without installing:

```sh
pi -e ./src/index.ts
```

Pick one route. Installing from both npm and the collection loads this extension twice.

## Behavior

Deletion happens during Pi's shutdown, after the session file's last write, so nothing recreates it on the way out. Files go to the `trash` CLI when it exists and are unlinked otherwise. A file that resists both is reported to stderr after exit; the remaining files are still deleted.

Cascade covers the whole descendant subtree at any depth, but only within the current project's session directory. A session forked into a different project keeps its own files — that separation is deliberate, so a cascade never reaches across projects.

Deleting only the current session leaves its children pointing at a file that is gone. Pi's session picker treats them as roots, which is the intended result.

`/delete` reports and does nothing for an ephemeral session (`--no-session`) or outside interactive mode.

## How the picker key is added

Pi's picker consumes its own keys and offers no hook, and extension shortcuts registered with `registerShortcut` only reach the editor. So the binding is installed by wrapping `handleInput` on `SessionSelectorComponent`, which Pi exports from its package entry, plus the header's `render` to show the hint.

That class is public; the fields the patch drives (`sessionList`, `currentSessions`, `header`, and the rest) are not. Every one is verified before the patch acts on a keystroke. If any is missing or the wrong shape, the patch reports once and forwards every key to Pi untouched, so a Pi upgrade that moves these internals costs the cascade binding and nothing else. The hint is skipped silently when the confirmation line no longer matches or the row is full. Both patches are removed on shutdown and reload.

## Development

From the repository root, which installs the workspace and this package's pinned Pi host:

```sh
npm ci --ignore-scripts
npm --workspace @allenyolk/pi-delete run check
```

Tests cover descendant collection (including cycles in `parentSessionPath`), the rule that keeps the active session out of a cascade, and the trash/unlink/report path. The repository's `test/` checks drive `/delete`, the cascade, cancellation and the picker's active-session rule through a real TUI in a PTY, with `@allenyolk/pi-minimal-display` loaded alongside.

`npm --workspace @allenyolk/pi-delete run sandbox` builds a throwaway profile with a four-session tree and prints the commands to open Pi against it, so the interactive flow can be exercised by hand without touching real sessions. Both surfaces were verified this way against Pi 0.87.1 by driving a real TUI in a PTY: `/delete` (cascade, current-only, cancel, leaf, ephemeral) and the picker key (cascade, native single delete still intact, cancel, leaf, active-session refusal, active-session-as-descendant, and `t` still reaching the search box outside the confirmation).

`test/keyprobe.py` prints what a terminal actually sends for a key, which is how keybinding questions get settled rather than guessed.

## License

MIT, copyright AllenYolk.
