# @allenyolk/pi-delete

## 0.4.1

### Patch Changes

- 633a3d8: Polish the Batch mode chrome. A range preview now draws in a gutter that every row always reserves, so the mark box, tree and label keep their columns whether or not a range is open. The heading and the key hints each get a blank line of their own, the filter controls show their default or active state by colour, and the hints are grouped by purpose in Pi's hint style — one group per line, labels in a shared column, whole hints dropped from the end of a group instead of cut in half on a narrow terminal. Keys and behavior are unchanged.

## 0.4.0

### Minor Changes

- 2d836c6: Add Batch mode to `/resume`. Press `ctrl+x` to mark individual sessions, visible subtrees, or ranges. Toggle or invert visible marks, and keep selections across search, cleanup filters, and folder scopes. Review all marked sessions and their hidden task transcripts before deleting them in one confirmation.

## 0.3.3

### Patch Changes

- Cascade deletes now include the subagent sessions pi-subagents keeps in `<session>/tasks/`, which Pi's listing never shows, and remove the emptied directories. The active session keeps its own subagent sessions.
- `/delete` now removes its targets at process exit, after every extension's shutdown handler, so a transcript written while pi-subagents aborts a running child cannot survive the cascade.

## 0.3.2

### Patch Changes

- 63f2e0d: Point the package metadata at the new source repository. Both packages now live in
  `AllenYolk/pi-extensions` under `packages/`, so `repository.url` and the new
  `repository.directory` field resolve to the actual source location. Runtime behaviour,
  commands, keybindings, configuration paths and certified Pi hosts are unchanged.
