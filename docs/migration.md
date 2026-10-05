# Migration to one source repository

Status: the source migration is published in [AllenYolk/pi-extensions](https://github.com/AllenYolk/pi-extensions),
including the original commit history, archive refs and PR-review workflow. The first npm
releases from this repository, pi-delete 0.3.2 and pi-minimal-display 0.1.3, were published on
2026-10-05; [the publish run](https://github.com/AllenYolk/pi-extensions/actions/runs/37294136121)
and both npm Repository links were verified. After the owner's authorization, the two old
repositories were deleted on 2026-10-05; their complete Git bundles were verified before
deletion, and the original commit/tag objects and discussion archives remain preserved.

## Why

`@allenyolk/pi-delete` and `@allenyolk/pi-minimal-display` were two repositories with
duplicated engineering setup: two lockfiles, two CI definitions, two copies of the triage
and release conventions, and two places to keep the same Pi-host knowledge. Nothing about
the packages themselves required the split — they share no runtime code and no dependency on
each other.

One repository, two independently versioned and independently published packages.

## What stays the same

The packages keep their npm names, their commands, keybindings, configuration paths, error
semantics and patch lifecycles. No host upgrade, runtime refactor or new feature rides along
with this migration. `@allenyolk/pi-delete` remains certified on Pi 0.87.1 and
`@allenyolk/pi-minimal-display` on Pi 0.85.0, 0.85.1 and 0.99.1; neither support range is
widened here.

Existing npm installations need no action.

## Tasks

### 1. History and source import

- Record the baseline, back up both repositories as recoverable bundles, and export issues,
  comments, reviews, releases and labels. See [docs/archive](archive/README.md).
- Import both main branches with `git subtree add` without `--squash`, so commits keep their
  original SHAs, authors and dates and stay connected to `main`.
- Keep old branches and tags as `archive/<repository>/…` refs.
- Treat archive refs as historical snapshots, not active development branches; preserve their
  commit/tag objects and the old issue-number namespace.
- Render the archived discussions as readable Markdown, rewriting bare `#N` references so
  they cannot resolve against this repository's own issues.

### 2. Installation, CI and release verification

- One root lockfile and npm workspaces. TypeScript and `@types/node` are shared at the root;
  each package keeps the Pi development dependency version it certifies.
- The display tests resolved their Pi host through a fixed `./node_modules` path. That only
  held in a standalone repository, so they now use Node's native resolver to find the host
  the package imports. CI runs only the latest tested host for each package; older results
  remain historical evidence rather than additional CI combinations.
- Root `test/` covers the two behaviours only the collection has: git collection
  installation with resource filtering, and both extensions loaded in one session.
- No install lifecycle scripts, so a git installation that omits development dependencies
  still loads the TypeScript entries.

### 3. Release and old-repository removal

- Changesets with empty `fixed` and `linked`, so only the packages a change touches get a
  version bump.
- The publish workflow is manual only and publishes through npm trusted publishing with
  OIDC. Each npm package must be bound to this repository as a trusted publisher first.
- On a partial failure, keep the old repositories and republish only the missing package from
  the same commit. Never overwrite a published version.
- Delete the old repositories only after history, backups, installation, CI and npm
  publication have all been verified. Rollback relies on the saved history and the already
  published npm versions, not on GitHub's deletion grace period.

## Accepted consequences

| Effect | Handling and residual limit |
| --- | --- |
| The old git install addresses stop working | Unavoidable once the repositories are deleted. Users of those addresses switch to the npm packages or to this collection. |
| Old issue, pull-request and release links break | The content is archived here and documentation references are corrected. GitHub's original discussion pages and numbering cannot be preserved. |
| Already published npm versions still point at the old repositories | Installation keeps working; only the repository links inside those old versions break. New versions carry corrected metadata. |
| The git collection and the npm packages can both be installed | The READMEs state that the two installation routes are alternatives. Switching sources means removing the old declaration and restarting. |
| The collection enables both extensions by default | The npm packages stay the recommended entry point; the collection documents the resource filter. Extensions added later would also reach unfiltered collection users. |
| Directory history is less direct than an unchanged path | Original commits keep their old layout and remain readable by SHA. A directory history view is not guaranteed to cross the import boundary. |
