# @allenyolk/pi-delete

## 0.3.3

### Patch Changes

- Cascade deletes now include the subagent sessions pi-subagents keeps in `<session>/tasks/`, which Pi's listing never shows, and remove the emptied directories. The active session keeps its own subagent sessions.

## 0.3.2

### Patch Changes

- 63f2e0d: Point the package metadata at the new source repository. Both packages now live in
  `AllenYolk/pi-extensions` under `packages/`, so `repository.url` and the new
  `repository.directory` field resolve to the actual source location. Runtime behaviour,
  commands, keybindings, configuration paths and certified Pi hosts are unchanged.
