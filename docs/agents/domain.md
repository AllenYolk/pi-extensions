# Domain docs

Layout: single-context. Read CONTEXT.md at the repository root before exploring code and the relevant decisions under the owning package's docs/adr/ before changing the affected behavior. If they do not exist, proceed; create them only when terminology or a decision has actually been resolved.

CONTEXT.md is the domain glossary, not the implementation spec. Use its terms consistently in issues, code, and tests. Surface contradictory ADRs explicitly before replacing a decision. Specs and implementation tasks live in GitHub Issues; issue-tracker.md describes the workflow.

If the repository later adopts CONTEXT-MAP.md, read the mapped contexts relevant to the task and update this layout deliberately. Both packages share this one glossary. Do not introduce a second context per package; record package-specific decisions as ADRs under that package instead.
