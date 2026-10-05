# Contributing

For runtime work, start from an issue in AllenYolk/pi-extensions and state the observable
behavior and acceptance cases before implementation. An explicit owner request is sufficient
for a small documentation or tooling task. Keep one focused change per branch, identify the
affected package or root tooling, and link the PR to its issue when there is one. Use the
vocabulary in CONTEXT.md and read decisions under the owning package's `docs/adr/`.

Implement one tested behavior at a time. Tests exercise configuration loading,
activation/disposal, observable native/compact rendering, session deletion through the real
prompt and picker, and the real packaged CLI load. Avoid asserting private call counts or
private implementation steps, and do not generate expected output from the implementation
itself.

## Required checks

Run commands from the repository root. Install with `npm ci --ignore-scripts`; the PTY
checks also need `uv python install 3.12`. Use Node/npm versions supported by the root
manifest and the existing CI workflow rather than introducing another package manager.

Choose the smallest existing check that covers the change:

| Change | Check |
| --- | --- |
| One package's runtime | `npm --workspace @allenyolk/pi-delete run check` or `npm --workspace @allenyolk/pi-minimal-display run check` |
| Presentation/rendering | Package check plus `npm run benchmark`, comparing the same Node/Pi/workload and output |
| Shared tooling, package loading, metadata or cross-package lifecycle | `npm run check`, which includes both workspaces and repository `test/` |
| Repository-only documentation | Check local links, referenced paths/commands and agreement with code/manifests; no runtime suite or changeset required |

Expand checks when a failure or another affected boundary justifies it. A release candidate
requires the complete checks and package inspection below. List skipped environments rather
than claiming that local macOS results also verify Linux.

A packaged README change follows docs/publishing.md for release intent; its versioned
installation examples must name an already published version or a clearly marked candidate.

Each package keeps its own certified Pi version as a development dependency, and the tests
resolve the host the package itself resolves. Do not change a package's Pi version to make a
check pass, and do not add a shared Pi version that silently retargets a package check.

CI re-verifies each package on its latest tested host; its environment matrix lives in
`.github/workflows/check.yml`. Keep historical compatibility evidence without adding another
legacy-host matrix. The upstream-version warning detects release drift, not certified
support; add a host signature only after real CLI, rendering, replay, expansion, errors and
repeated lifecycle checks pass on that exact version.

## Integration-test constraints

- Set `PI_CODING_AGENT_DIR` before loading a host or extension and use a fresh disposable
  profile with synthetic session files; the tests need no model account or personal sessions.
- Resolve a host from the owning workspace, as the existing `pi-host.mjs` does; a fixed
  `./node_modules` path can pick a different Pi version after npm hoisting.
- Git-install fixtures serve committed `HEAD`; validate a committed candidate when testing
  installed artifacts, and preserve the full-history checkout in CI.
- PTY steps wait for the view that actually changed; selection can repaint menu rows while
  leaving the footer unchanged on Linux.

Independent review covers standards and the spec separately. Resolve release-blocking findings
with regression evidence before marking a candidate ready. A green mocked test is not evidence
of real-host compatibility.

## Pull request review

OpenCodeReview runs when a PR opens, receives commits, reopens or becomes ready for review.
Owners, members and collaborators can rerun it by commenting `/ocr`; other comments do not
cancel an active review. The workflow uses the trusted base checkout, reads the PR diff from
Git objects and never installs or executes the PR's code. It keeps a sticky summary and adds
new inline findings without deleting earlier discussion.

Configure repository Secrets `OCR_LLM_URL`, `OCR_LLM_AUTH_TOKEN` and `OCR_LLM_MODEL` for the
OpenAI-compatible model endpoint. The workflow requests concrete, actionable findings and
keeps style or documentation notes in the summary. The completion guard from SpikingJelly
allows useful partial findings through, but fails an incomplete review with no findings.
Partial findings are not evidence that the entire PR was reviewed.

ChatGPT review can be enabled separately in the owner's GitHub integration. Automated
reviews supplement behavior checks and the independent Standards/Spec release review.

## Release checklist

- Follow [docs/publishing.md](docs/publishing.md) for Changesets, version PRs, owner
  authorization, manual workflow dispatch and registry/Release verification.
- Confirm the spec issue's acceptance criteria and record the exact reviewed commit.
- Complete type, behavior, real CLI lifecycle, package-load, collection-install and
  rendering-performance checks.
- Inspect `npm pack --json --ignore-scripts` in the package: only source, README, LICENSE and
  package metadata belong in the tarball, and the `repository.directory` field must point at
  the package.
- Confirm the source entry loads without a local build; no install lifecycle scripts,
  credential reads, telemetry or bundled Pi core.
- Record tested platforms/versions, known limits, rollback instructions and independent-review
  outcomes.

The README at the root describes the collection; each package README describes its own
public behavior. Keep historical results in the existing validation/archive documents and
record new verification on the task or PR rather than creating a second status ledger.

MIT contributions must have clear provenance. Do not copy compact-display source under an
assumed license: its package metadata and LICENSE disagree.
