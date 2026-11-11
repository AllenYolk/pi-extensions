---
"@allenyolk/pi-compaction": patch
---

Document what to do when `thinking: "off"` does not take effect.

A model's `thinkingLevelMap` decides which levels it accepts, and a level mapped to `null` is
unsupported — so such a model is clamped to its lowest level and reasons anyway, with nothing bounding
it now that this package sends no output ceiling. The README said only that this can happen.

It now explains how to read the level that actually ran from `/compaction`, that the property is
per-model rather than per-provider (two models behind one gateway can differ), how to inspect what a
model declares, and that changing `thinkingLevelMap.off` is a request to the provider whose failure is
reversible.

The repository README is corrected at the same time. Its package table still described this package as
bounding the summary with two token budgets and pruning old tool results, and its install section said
the package was not on npm yet and named a `"preset": "off"` setting. None of the three is true of
`0.2.0`: the ceiling and the prune path were removed before the first release, and the presets went
with them.
