# Releasing

Status rechecked 2026-10-05 against [Pi 0.99.1 package dependencies](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/packages.md#declare-dependencies).
This document describes release mechanics; it does not authorize publishing a release.

## Package contract

Pi packages may be shared through npm or git. Each package here declares an explicit
`pi.extensions` entry because its TypeScript extension lives at `src/index.ts`, and Pi loads
that source directly — no generated `dist/` is required for loading. The `pi-package` keyword
enables gallery discovery, and host-provided `@earendil-works/pi-*` imports stay unbundled
`"*"` peers. See [Pi packages](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/packages.md)
and [Pi extensions](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/extensions.md).

The repository root declares both entries, so the repository itself installs as one
collection. The root is `private: true`; there is no third npm package.

Each package manifest carries `repository.directory`, so npm shows the right subdirectory.

The packed artifact is still inspected on every release because it catches accidental files,
dependencies and lifecycle scripts.

## Install and update

```sh
# Recommended: the independent npm packages
pi install npm:@allenyolk/pi-delete
pi install npm:@allenyolk/pi-minimal-display

# Or the whole collection, following its default branch
pi install git:github.com/AllenYolk/pi-extensions

# Pin the collection to one immutable commit
pi install git:github.com/AllenYolk/pi-extensions@<commit-sha>

pi remove npm:@allenyolk/pi-minimal-display
pi remove git:github.com/AllenYolk/pi-extensions
```

`pi update --extensions` updates packages; `pi update --all` updates Pi and packages. An
unpinned git source follows its default branch. A pinned ref is only reconciled to that ref,
so moving to a newer commit requires installing the new ref.

Pin per package with an npm version. Changesets tags releases as
`@allenyolk/<package>@<version>`, and Pi's git ref parser splits on the first `@`, so a
scoped package tag cannot be used as a git ref — pin the collection by commit instead.

## Versioning

[Changesets](../.changeset/README.md) manages the two packages independently. `fixed` and
`linked` are both empty, so a change to one package never bumps the other.

```sh
npm run changeset          # describe the change and pick the affected packages
npm run version-packages   # apply pending changesets and refresh the root lockfile
```

The version bump is a pull request. Merge it only after Standards and Spec review pass
independently.

## Publishing

The release workflow is `workflow_dispatch` only, and it refuses to run on anything but a
`main` commit whose CI run succeeded. It publishes with `changeset publish` using npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers/) over OIDC, so no npm token is
stored in this repository.

Before the first publication from this repository, bind each existing npm package to it as a
trusted publisher:

- `@allenyolk/pi-delete` → `AllenYolk/pi-extensions`, workflow `.github/workflows/publish.yml`
- `@allenyolk/pi-minimal-display` → same repository and workflow

npm registry tarballs are immutable: once `name@version` is published, a fix needs a new
version even if the old one is unpublished. See
[npm scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
and the [npm unpublish policy](https://docs.npmjs.com/policies/unpublish/).

If one package publishes and the other fails, republish only the missing one from the same
commit. Never move or reuse a published version, and keep the old repositories until both
packages are confirmed published.

## Release history before this repository

`@allenyolk/pi-delete` released 0.1.0 through 0.3.1, and `@allenyolk/pi-minimal-display`
0.1.0 through 0.1.2, in their own repositories. Those tags, releases and release notes are
archived under [docs/archive](archive/README.md); the commits are reachable here through
`archive/<repository>/…` refs.
