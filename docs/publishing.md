# GitHub releases

Status checked 2026-09-06 against Pi 0.85.1 and the public Pi documentation; the package contract was rechecked on 2026-09-30 against [Pi 0.99.1 package dependencies](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/packages.md#declare-dependencies). This document describes release mechanics; it does not authorize publishing a release.

## Package contract

Pi packages may be shared through npm or Git. This repository uses an explicit `pi.extensions` entry because its TypeScript extension lives at `src/index.ts`; Pi loads that source directly. The `pi-package` keyword enables gallery discovery, and host-provided `@earendil-works/pi-*` imports remain unbundled `"*"` peers. See [Pi packages](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md) and [Pi extensions](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md).

The packed artifact is still checked because it catches accidental files, dependencies and lifecycle scripts, but a GitHub release needs no uploaded npm tarball: Pi clones the repository or selected Git ref.

## Install and update

```sh
# Follow the default branch
pi install git:github.com/AllenYolk/pi-minimal-display

# Pin one immutable release
pi install git:github.com/AllenYolk/pi-minimal-display@v0.1.2

# One-run trial
pi -e git:github.com/AllenYolk/pi-minimal-display@v0.1.2

pi remove git:github.com/AllenYolk/pi-minimal-display
```

`pi update --extensions` updates packages; `pi update --all` updates Pi and packages. An unpinned Git source follows its default branch. A tag or commit ref is pinned and only reconciled to that ref, so moving from `v0.1.0` to `v0.1.1` requires installing the new ref. See [Pi package sources and updates](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md#package-sources).

## Release `v0.1.0`

1. Merge the reviewed implementation and release preparation to `main`.
2. On the exact release commit, run `npm ci --ignore-scripts`, `npm run check`, `npm run benchmark`, and `npm pack --dry-run --json`; verify the six-file artifact and no lifecycle scripts or runtime dependencies.
3. Verify both tested Pi hosts, 0.85.0 and 0.85.1. Runtime activation is based on tested presentation-method signatures rather than version equality; an incompatible host safely stays native.
4. Create the annotated tag `v0.1.0` on that commit and publish a GitHub release with concise behavior, compatibility, installation and recovery notes. Do not attach generated build output.
5. Test pinned and unpinned Git installation, loading, update and removal in disposable profiles before replacing the owner's local trial.

GitHub release descriptions can be edited, but release tags are treated as immutable. Fixes receive a new SemVer version and tag (`v0.1.1`, `v0.2.0`, and so on); do not move or reuse an existing release tag. See [GitHub release management](https://docs.github.com/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

## Release `v0.1.1`

This patch release silently routes the exact native thinking-visibility status emitted by Pi's toggle action while preserving native state, persistence, repaint and unrelated status messages. It adds the matching host signatures and real-host regression coverage. Publish the immutable GitHub tag and public npm package from the exact release commit.

## Release `v0.1.2`

This patch release accepts Pi 0.99.1 by allowlisting its SDK and bundled-CLI presentation signatures after the full real-host suite passed on that version; runtime behavior is unchanged. CI re-verifies Pi 0.85.1 and 0.99.1. Publish the immutable GitHub tag and Release from the exact release commit; the owner publishes the npm package from the same commit.

## npm publication

`@allenyolk/pi-minimal-display@0.1.2` is a public scoped npm package. npm registry tarballs are immutable: once a `name@version` has been published, fixes require a new version even if the old one is unpublished. See [npm scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/) and the [npm unpublish policy](https://docs.npmjs.com/policies/unpublish/).
