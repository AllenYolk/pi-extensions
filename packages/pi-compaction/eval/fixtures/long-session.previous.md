## Goal
Fix the intermittent shard restart on tessera staging, and understand the read-path latency regression that
appeared in the same deploy.

## Constraints & Preferences
- do not change the on-disk format
- no new runtime dependencies
- Anything touching the ledger IO goes in its own commit with a note.

## Progress
### Done
- [x] Reproduced the restart on a staging box with a loop over 40 restarts.
- [x] Read src/index/manifest.ts and src/cache/spill.rs; both are unchanged from v0.9.2.

### In Progress
- [ ] Find the code path that raises the manifest-already-open error.

### Blocked
- Production cannot be profiled without a change window.

## Key Decisions
- **Reproduce before reading**: a 40-restart loop is cheap and rules out the deploy timeline.

## Next Steps
1. Trace the reopen path from the shard supervisor into the index.
2. Decide whether the latency regression is the same fault.

## Critical Context
- The nodes listen on port 7717 and the release freeze is 2026-03-14.
- Questions go in #tessera-oncall, not DM.
