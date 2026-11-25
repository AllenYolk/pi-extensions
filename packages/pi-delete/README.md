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

The cascade adds no top-level keybinding: `t` answers the native delete confirmation. In the native picker outside that confirmation, `t` goes to the search box as usual.

The subtree is already drawn in the list, so the prompt does not repeat the names.

The active session is never deleted — not when the cursor is on it, and not when it sits somewhere below the node being cascaded; in that case it is held back and the rest still go.

### Batch mode

Press **`ctrl+x`** in `/resume` to mark several sessions. Batch mode starts with the picker's
scope, sort, name filter, search query, and cursor.

- **↑/↓** and **PgUp/PgDn** move the cursor; **`g`/`G`** jump to the first/last visible row.
- **Space** toggles one row. **`t`** toggles that row and its visible descendants: if any
  selectable row in the subtree is unmarked, `t` marks them all; otherwise it unmarks them.
- **`v`** starts a range at the cursor. Move with the same navigation keys to preview it.
  **Space** or **`v`** adds the range to the selection without clearing existing marks.
  **Esc** cancels the preview and stays in Batch mode. A list refresh also cancels the preview.
- **`a`** marks all visible selectable rows, or unmarks them if they're all marked.
  **`i`** inverts the visible marks. Neither touches hidden marks. **`c`** clears every mark,
  even those hidden by a search, filter, or folder scope.

The active session is never marked or deleted by Batch mode, and its tasks stay on disk.

Press **`/`** to edit the search. Use fuzzy terms, a `"quoted phrase"`, or a case-insensitive
`re:<pattern>`. **Enter** or **Esc** returns to the list and keeps the edited query. In the list,
**Tab** switches between Current Folder and All Folders, **`n`** cycles All/Unnamed/Named,
**`o`** cycles Any age/older than 7 days/older than 30 days, and **`m`** limits the list to
sessions with at most two messages. **`s`** cycles Threaded/Recent/Fuzzy and **`p`** toggles paths.
With an active search, Recent keeps matches newest-first; Fuzzy and Threaded rank them by match
score, breaking ties by recency. The controls compose. Marks survive every filter and scope
change; the heading counts any marked sessions hidden from the list.

Press **`d`** or **Enter** to review the selection. The review counts listed sessions and hidden
`<session>/tasks/` transcripts separately and puts red **`[named]`** warnings at the top. Each
marked session brings only its own tasks (including nested tasks). Unmarked forks and their
files stay untouched. Review and deletion include every mark, even from another folder or hidden
by a filter.
Use **↑/↓** or **PgUp/PgDn** to scroll the review. **Esc** returns to the list without clearing marks.
**Enter** deletes, refreshes in place, and keeps any listed sessions that failed to delete marked.
**Esc** from the Batch list returns to the native picker in the last-used scope with the
refreshed sessions. Native search, sort, name filter, and path visibility are unchanged.

Neither picker extension is available in the picker that `pi --resume` opens at startup.
That picker returns before Pi loads extensions, so resume into a session first, then use `/resume`.

## Install

```sh
pi install npm:@allenyolk/pi-delete
```

Or take it from the [pi-extensions collection](../../README.md#install), which also enables
`@allenyolk/pi-minimal-display` unless you narrow it with a resource filter:

```sh
pi install git:github.com/AllenYolk/pi-extensions
```

Or from the repository root, without installing:

```sh
pi -e ./packages/pi-delete/src/index.ts
```

Pick one route. Installing from both npm and the collection loads this extension twice.

## Behavior

`/delete` removes files when Pi exits, after all extensions finish shutting down, so nothing recreates them on the way out — including a transcript that pi-subagents writes while aborting a running child. Picker deletion runs in place. The extension uses `trash` when available and falls back to unlinking. If neither works, it reports the failure and continues with the other files.

The `/delete` cascade covers the whole descendant subtree at any depth, but only within the current project's session directory. A session forked into a different project keeps its own files.

It also covers subagent sessions that [`@gotgenes/pi-subagents`](https://www.npmjs.com/package/@gotgenes/pi-subagents) stores beside their parent in `<session>/tasks/`. Pi's picker never lists that directory, and their headers record the parent's ID rather than its path, so the directory is how they are found: for the selected session, every listed descendant, and each subagent session in turn. `/delete` lists them with the rest; the picker does not draw them, so its status line counts them separately (`Deleted 4 sessions (1 hidden)`): the total minus the hidden ones matches the subtree you see. Once a directory is empty it is removed too; anything else left inside keeps it. The active session's own subagent sessions are held back with it, since its subagents may still be writing them. Deleting only one session — `Delete current session`, or `ctrl+d` then `enter` — leaves its subagent sessions on disk.

Deleting only the current session leaves its children pointing at a file that is gone. Pi's session picker treats them as roots, which is the intended result.

`/delete` reports and does nothing for an ephemeral session (`--no-session`) or outside interactive mode.

## How the picker keys are added

Pi's picker consumes its own keys and offers no hook, and extension shortcuts registered with `registerShortcut` only reach the editor. So the binding is installed by wrapping `handleInput` on `SessionSelectorComponent`, which Pi exports from its package entry, plus the header's `render` to show the hint.

That class is public; the fields the patch drives are not. If the required picker members
have changed, the patch reports once and forwards the key to Pi. Hints are skipped when
the expected header line is missing or has no room. The patches are removed on shutdown
and reload. Batch mode uses the [same layout swap as Pi's rename view](docs/adr/0001-batch-mode-inside-session-selector.md).

## Development

From the repository root, which installs the workspace and this package's pinned Pi host:

```sh
npm ci --ignore-scripts
npm --workspace @allenyolk/pi-delete run check
```

Tests cover descendant collection (including cycles in `parentSessionPath`), the rule that keeps the active session out of a cascade, and the trash/unlink/report path. The repository's `test/` checks drive `/delete`, the cascade, cancellation and the picker's active-session rule through a real TUI in a PTY, with `@allenyolk/pi-minimal-display` loaded alongside.

`npm --workspace @allenyolk/pi-delete run sandbox` builds a throwaway profile with a four-session tree and prints the commands to open Pi against it, so the interactive flow can be exercised by hand without touching real sessions. The repository PTY checks also exercise Batch mode with the collection host, the package's pinned host, and Pi 1.6.0.

`test/keyprobe.py` prints what a terminal actually sends for a key, which is how keybinding questions get settled rather than guessed.

## License

MIT, copyright AllenYolk.
