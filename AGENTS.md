# Agent guide

One source repository, independently installable and versioned extension packages under
`packages/`, and a private root workspace that also exposes a Git collection.

## Before editing

1. Check `git status` and `git remote -v`; preserve unrelated work and use the owner's request
   and linked issue as the task contract.
2. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
   [CONTEXT.md](CONTEXT.md) for terminology, state ownership and code entrypoints.
3. Read the affected package's README, implementation and nearest tests; load the references
   below only when the task needs them.

## Implementation boundaries

- Keep behavior and lifecycle state in the owning package; packages must work independently
  and must not import another extension's private implementation.
- Protect correctness/public contracts first and measured hot-path performance next; prefer
  existing code and Node/Pi APIs, adding abstractions or cached state only for a current need.
- Preserve public commands, configuration, errors, package entrypoints and serialized data;
  describe intentional contract changes in the affected README and task acceptance criteria.
- Keep host-provided Pi modules as unbundled peers and load the declared TypeScript source
  entry; preserve each package's own development host rather than relying on hoisting.
- Keep runtime patches in their owning adapter, validate the host seam, and preserve native
  fallback, patch ownership and cleanup on reload and shutdown.
- Preserve tool execution, tool schemas, model context and session contents when changing
  presentation; Pi's native thinking/expansion state remains authoritative.
- Use disposable profiles and synthetic sessions for checks; keep credentials and private
  sessions out of tracked files, and do not patch installed Pi or `node_modules` as a fix.
- Review substantial responsibility, lifecycle or cross-component refactors before coding;
  record the problem/evidence, target owners/dependencies, preserved and changed behavior,
  alternatives, migration/rollback, validation and the old paths to remove.

## Validation and delivery

- Choose checks by changed behavior using CONTRIBUTING.md; docs-only edits need link and
  consistency checks, not a new test suite.
- Verify user-visible behavior at existing seams, including real-host loading and cleanup
  for host-facing changes; report the command, result and any unverified environment.
- Keep one focused change per branch, inspect the final diff, and stage only intended files.
- Add Changesets release intent only when a published package changes; follow
  [docs/publishing.md](docs/publishing.md) for versioning and publication.
- Publication, daily-profile activation and repository retirement require explicit owner
  authorization; honor authorization already given for the specific operation.

## Read on demand

| Task | Reference |
| --- | --- |
| Display grouping, rendering or host compatibility | [Display README](packages/pi-minimal-display/README.md), [render-time ADR](packages/pi-minimal-display/docs/adr/0001-project-the-transcript-at-render-time.md), [validation evidence](packages/pi-minimal-display/docs/validation.md) |
| Session deletion, cascade or picker behavior | [Delete README](packages/pi-delete/README.md), deletion ownership in CONTEXT.md |
| Package metadata, version PRs or publishing | [Release workflow](docs/publishing.md) and the relevant manifests/workflows |
| Issues or PR coordination | [Issue tracker](docs/agents/issue-tracker.md), [triage labels](docs/agents/triage-labels.md) |
| Domain terminology or architecture decisions | [Domain documentation conventions](docs/agents/domain.md) |
| Migration history or original specs | [Migration record](docs/migration.md), [archive index](docs/archive/README.md); archived issue numbers belong to the old repositories |
