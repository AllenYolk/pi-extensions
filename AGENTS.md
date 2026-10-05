# Working on the Pi extensions

This repository holds two independent packages under `packages/`. Keep a change inside the
package it belongs to, and treat anything at the root as shared by both.

Read the issue and relevant spec before implementation. Keep one issue-sized change per
branch. Record acceptance criteria and validation evidence in the issue. Change the spec
explicitly when behavior changes.

Implement runtime behavior in vertical slices: failing behavior check, minimal
implementation, regression check. Tests must exercise the approved configuration, lifecycle,
rendering, and package-loading interfaces, with real Pi integration for host-facing behavior.

Keep runtime patches inside this repository. Never modify an installed Pi or third-party
node_modules as a product fix. Use disposable profiles and subprocesses for testing. Preserve
tool execution, schemas, session data, and model context.

Each package certifies its own Pi host versions and keeps that version as its own development
dependency. Do not widen a package's support range to match the other one, and do not let
workspace hoisting decide which host a check runs against.

Before declaring a release candidate, require type checking, behavior tests, real-host
loading/rendering/reload checks, package inspection, the collection checks in `test/`, and an
independent review with no unresolved release blockers. Report skipped checks accurately.
Publishing and activating in the owner's daily profile require separate explicit
authorization.

## Agent skills

### Issue tracker

Use GitHub Issues in AllenYolk/pi-extensions. See docs/agents/issue-tracker.md.

### Triage labels

Use the five canonical triage labels. See docs/agents/triage-labels.md.

### Domain docs

Use the single root CONTEXT.md glossary and the per-package decisions under
`packages/*/docs/adr/`. See docs/agents/domain.md.
