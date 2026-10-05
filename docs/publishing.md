# Releasing

Read package manifests and registry metadata for current versions, and the workflows for
toolchain pins. This document describes release mechanics; it does not authorize publishing
a release. Repository-only documentation and CI changes do not trigger npm publication.

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

Add a changeset when an affected package's published behavior, source, metadata or packaged
README changes; select only that package and the appropriate patch/minor/major intent.
Root documentation, tests and tooling-only changes can omit a changeset. Versions belong in
each package's `package.json`; Changesets also updates its changelog and the root lockfile.

```sh
npm run changeset          # describe the change and pick the affected packages
npm run version-packages   # apply pending changesets and refresh the root lockfile
```

Develop the feature or fix with its release intent first, then apply pending changesets in
a version PR. Review the generated diff, run the complete checks and inspect both actual
package tarballs. Merge only after the independent Standards and Spec review gates in
CONTRIBUTING.md are satisfied; bumping metadata alone is not a release.

## Publishing

The release workflow is `workflow_dispatch` only, and it refuses to run on anything but a
`main` commit whose complete `Check` workflow succeeded for that exact SHA. Pending changesets
must have been applied in the reviewed version PR. It publishes with `changeset publish` using npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers/) over OIDC, so no npm token is
stored in this repository.

Both npm packages are bound to this repository through GitHub Actions trusted publishing.
When inspecting or repairing that configuration, the expected values are:

- `@allenyolk/pi-delete` → `AllenYolk/pi-extensions`, workflow filename `publish.yml`
- `@allenyolk/pi-minimal-display` → same repository and workflow

Leave Environment name empty, matching the workflow's lack of a GitHub environment, and
allow `npm publish`. Keep credentials in the existing secret/trust mechanisms; do not add an
npm token to source or replace the owner's trust settings as a troubleshooting shortcut.

After the owner authorizes the package versions and release commit:

1. Confirm the candidate's full SHA is on `main`, its complete `Check` push run succeeded,
   and all pending changesets have been applied.
2. Open GitHub Actions → **Publish packages** → **Run workflow**, select `main` and enter
   that full SHA; alternatively dispatch the same workflow with `gh`:

   ```sh
   gh workflow run publish.yml --repo AllenYolk/pi-extensions --ref main -f "commit=$release_sha"
   ```

   Set `release_sha` to the approved, CI-tested commit; dispatching is the publication step.
3. Monitor the run and its final package summary; the workflow publishes missing versions,
   pushes package tags and creates the corresponding GitHub Releases.
4. Verify each intended version exists on npm with the expected `latest` tag,
   `repository.url` and `repository.directory`, plus a non-draft GitHub Release/tag on the
   intended source commit; a green workflow alone does not prove registry visibility.

Use fresh registry reads when checking propagation; cached metadata can temporarily show an
older `latest` value:

```sh
npm view @allenyolk/pi-delete version repository dist-tags --prefer-online --json
npm view @allenyolk/pi-minimal-display version repository dist-tags --prefer-online --json
gh release list --repo AllenYolk/pi-extensions
```

Also check the npm package page's Repository link points at this repository. Existing npm
users keep the same source declarations; once approved for their profile, normal Pi package
updates fetch the new versions without moving the display configuration.

npm registry tarballs are immutable: once `name@version` is published, a fix needs a new
version even if the old one is unpublished. See
[npm scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
and the [npm unpublish policy](https://docs.npmjs.com/policies/unpublish/).

On a partial failure, inspect the failed step and registry state before retrying the same
approved SHA: Changesets skips versions already published, and the workflow completes missing
tags/Releases. Changed package content requires a new version; never move a published tag or
reuse a version. Registry/trust/2FA failures need the owner's account action when agent access
is unavailable. Repository retirement is separate from publication.

## Release history before this repository

`@allenyolk/pi-delete` released 0.1.0 through 0.3.1, and `@allenyolk/pi-minimal-display`
0.1.0 through 0.1.2, in their own repositories. Those tags, releases and release notes are
archived under [docs/archive](archive/README.md); the commits are reachable here through
`archive/<repository>/…` refs.
