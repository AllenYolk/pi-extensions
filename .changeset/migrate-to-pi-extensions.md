---
"@allenyolk/pi-delete": patch
"@allenyolk/pi-minimal-display": patch
---

Point the package metadata at the new source repository. Both packages now live in
`AllenYolk/pi-extensions` under `packages/`, so `repository.url` and the new
`repository.directory` field resolve to the actual source location. Runtime behaviour,
commands, keybindings, configuration paths and certified Pi hosts are unchanged.
