# Contributing

Start from an issue in AllenYolk/pi-extensions. State the observable behavior and acceptance
cases before changing runtime code. Keep one issue-sized change per branch and link its PR to
the issue. Say which package the change belongs to. Use the vocabulary in CONTEXT.md and read
the relevant decisions under `packages/*/docs/adr/`.

Implement one tested behavior at a time. Tests exercise configuration loading,
activation/disposal, observable native/compact rendering, session deletion through the real
prompt and picker, and the real packaged CLI load. Avoid asserting private call counts or
private implementation steps, and do not generate expected output from the implementation
itself.

## Required checks

Run `npm run check` from the root: it runs each package's own checks and then the collection
checks in `test/`. For rendering changes also run `npm run benchmark` with the same Node, Pi
and workload as the baseline, and record what was measured. The CLI and picker probes need uv
and Python 3.12; use `uv python install 3.12`.

Each package keeps its own certified Pi version as a development dependency, and the tests
resolve the host the package itself resolves. Do not change a package's Pi version to make a
check pass, and do not add a shared Pi version that silently retargets a package check.

CI re-verifies each package on its own certified hosts across Linux/macOS and Node
22.19.0/24.12.0. The upstream-version job detects release drift; it does not certify a new
host. Add a host signature only after real CLI, rendering, replay, expansion, errors, and
repeated lifecycle checks pass on that exact version.

Independent review covers standards and the spec separately. Resolve release-blocking findings
with regression evidence before marking a candidate ready. A green mocked test is not evidence
of real-host compatibility.

## Release checklist

- Add a changeset for the packages the change actually affects, and no others.
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
- Publication runs from the manually triggered release workflow on a `main` commit that passed
  CI, and needs the owner's approval. Do not publish from a local shell.

MIT contributions must have clear provenance. Do not copy compact-display source under an
assumed license: its package metadata and LICENSE disagree.
