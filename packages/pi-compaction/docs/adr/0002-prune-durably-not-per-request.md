# Prune durably, and never omit a tool result

> **Superseded by [ADR 0005](0005-bound-by-not-bounding.md).** The output ceiling, the prune
> path and the acceptance of a length stop were all removed; see that ADR for why.

Pruning is recorded as persisted context-edit session entries carrying a replacement, not as a
rewrite of the outgoing message list. The transient request hook was rejected because the host
computes one of its two compaction triggers from the session projection, which such a rewrite never
reaches: pruning would then delay compaction on one path and not the other. A persisted edit is
visible to both, survives reload and resume, and is auditable in the session file. The raw entry is
never modified, so the pruned content remains on disk.

A pruned tool result is replaced, never omitted. Omitting it removes the result while leaving the
originating tool call in place, and the host's projection does not repair the resulting orphan;
providers reject that shape. A replacement keeps the entry's role and pairing and changes only its
content, which is exactly the bounded placeholder the design wants.

The consequence is that a pruned result is recoverable only by re-running its tool, since no recall
tool is in scope. That makes the never-prune list a correctness requirement rather than a tuning
knob: results of side-effecting or one-shot tools are information the session cannot get back.
