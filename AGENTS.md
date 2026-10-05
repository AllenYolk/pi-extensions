# Working on Pi Minimal Display

Read the issue and relevant spec before implementation. Keep one issue-sized change per branch. Record acceptance criteria and validation evidence in the issue. Change the spec explicitly when behavior changes.

Implement runtime behavior in vertical slices: failing behavior check, minimal implementation, regression check. Tests must exercise the approved configuration, lifecycle, rendering, and package-loading interfaces, with real Pi integration for host-facing behavior.

Keep runtime patches inside this repository. Never modify an installed Pi or third-party node_modules as a product fix. Use disposable profiles and subprocesses for testing. Preserve tool execution, schemas, session data, and model context.

Before declaring a release candidate, require type checking, behavior tests, real-host loading/rendering/reload checks, package inspection, and an independent review with no unresolved release blockers. Report skipped checks accurately. Publishing and activating in the owner's daily profile require separate explicit authorization.

## Agent skills

### Issue tracker

Use GitHub Issues in AllenYolk/pi-minimal-display. See docs/agents/issue-tracker.md.

### Triage labels

Use the five canonical triage labels. See docs/agents/triage-labels.md.

### Domain docs

Use a single CONTEXT.md glossary and docs/adr/ decisions. See docs/agents/domain.md.
