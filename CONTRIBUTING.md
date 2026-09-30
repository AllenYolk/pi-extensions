# Contributing

Start from an issue in AllenYolk/pi-minimal-display. State the observable behavior and acceptance cases before changing runtime code. Keep one issue-sized change per branch and link its PR to the issue. Use the vocabulary in CONTEXT.md and read relevant decisions in docs/adr/.

Implement one tested behavior at a time. Tests exercise configuration loading, activation/disposal, observable native/compact rendering, and the real packaged CLI load. Avoid asserting private call counts or generating expected output from the implementation itself.

## Required checks

Run `npm run check` and, for rendering changes, `npm run benchmark` with the same Node/Pi/workload as the baseline. Record what was measured. The CLI probes need uv and Python 3.12; use `uv python install 3.12`.

CI re-verifies the most recent tested Pi versions on Linux/macOS and Node 22.19.0/24.12.0. The upstream-version job detects release drift; it does not certify a new host. Add a host signature only after real CLI, rendering, replay, expansion, errors, and repeated lifecycle checks pass on that exact version.

Independent review covers standards and the spec separately. Resolve release-blocking findings with regression evidence before marking a candidate ready. A green mocked test is not evidence of real-host compatibility.

## Release checklist

- Confirm the spec issue's acceptance criteria and record the exact reviewed commit.
- Complete type, behavior, real CLI lifecycle, package-load, and rendering-performance checks.
- Inspect `npm pack --json --ignore-scripts`: only source, README, LICENSE and package metadata belong in the tarball.
- Confirm the source entry exists without a local build; no install lifecycle scripts, credential reads, telemetry or bundled Pi core.
- Record tested platforms/versions, known limits, rollback instructions and independent-review outcomes.
- Obtain the owner's publication approval before `npm publish` or installing into their daily profile.

MIT contributions must have clear provenance. Do not copy compact-display source under an assumed license: its package metadata and LICENSE disagree.
