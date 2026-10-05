# Archived history of the retired repositories

The two packages in this repository were developed as `AllenYolk/pi-delete` and
`AllenYolk/pi-minimal-display`. Both main branches were imported with `git subtree add`
without `--squash`, so their commits keep their original SHAs, authors and dates and are
reachable from `main` through the two import merges.

- [pi-delete](pi-delete.md) — issues, pull requests, releases and triage labels
- [pi-minimal-display](pi-minimal-display.md) — same, including its 27 closed items

Architecture decisions and validation evidence were not archived as prose: they are live
documents under `packages/pi-minimal-display/docs/`.

## Migration baseline

Recorded before the import, from the repositories and the npm registry.

| | pi-delete | pi-minimal-display |
| --- | --- | --- |
| GitHub default branch | `main` | `main` |
| Main branch tip | `47f2acb` | `310e361` |
| Last push | 2026-09-28T12:16:45Z | 2026-09-30T14:17:38Z |
| Commits (all refs) | 4 | 26 |
| Non-main branches | 0 | 12 |
| Tags | 4 | 3 |
| Pull-request refs | 0 | 13 |
| Issues and pull requests | 0 | 27 (all closed) |
| Issue comments | 0 | 33 |
| Pull-request review comments | 0 | 0 |
| GitHub releases | 0 | 3 |
| Triage labels | 10 | 14 |
| npm version at baseline | 0.3.1 | 0.1.2 |
| Certified Pi hosts | 0.87.1 | 0.85.0, 0.85.1, 0.99.1 |

## Recoverable backups

`git bundle create … --all` was taken from a `--mirror` clone of each repository, so the
bundles carry every branch, tag and `refs/pull/*` ref. Both verify as complete histories
and restore into an empty directory with refs identical to the mirror:

```sh
git clone --mirror pi-delete-all-refs.bundle pi-delete.git
git clone --mirror pi-minimal-display-all-refs.bundle pi-minimal-display.git
```

The bundles and the raw GitHub metadata JSON are delivered separately from this repository;
they contain the same information this directory renders as prose.

## Archived refs

Old branches and tags are kept under `archive/<repository>/…` so the two projects cannot
collide on same-named tags such as `v0.1.0`. Pull-request heads become
`archive/<repository>/pull-<number>` tags, which preserves the pull-request to commit
mapping that GitHub's `refs/pull/*` provided.

| Archived ref | Kind | Commit | Original ref |
| --- | --- | --- | --- |
| `archive/pi-delete/main` | branch | `47f2acb` | `refs/heads/main` |
| `archive/pi-delete/v0.1.0` | annotated tag (`63612bc`) | `20573d6` | `refs/tags/v0.1.0` |
| `archive/pi-delete/v0.2.0` | annotated tag (`15514c7`) | `c1b05c6` | `refs/tags/v0.2.0` |
| `archive/pi-delete/v0.3.0` | annotated tag (`2036403`) | `83bb68b` | `refs/tags/v0.3.0` |
| `archive/pi-delete/v0.3.1` | annotated tag (`b29d5fc`) | `47f2acb` | `refs/tags/v0.3.1` |
| `archive/pi-minimal-display/feat/config-contract` | branch | `b7956b3` | `refs/heads/feat/config-contract` |
| `archive/pi-minimal-display/feat/native-summary-cards` | branch | `8dad308` | `refs/heads/feat/native-summary-cards` |
| `archive/pi-minimal-display/feat/turn-presentation` | branch | `abfe85e` | `refs/heads/feat/turn-presentation` |
| `archive/pi-minimal-display/fix/native-expanded-details` | branch | `324ee3d` | `refs/heads/fix/native-expanded-details` |
| `archive/pi-minimal-display/fix/native-hidden-thinking` | branch | `1aede41` | `refs/heads/fix/native-hidden-thinking` |
| `archive/pi-minimal-display/fix/ordered-tool-groups` | branch | `c878c95` | `refs/heads/fix/ordered-tool-groups` |
| `archive/pi-minimal-display/fix/pi-0.99-host-26` | branch | `2b552a0` | `refs/heads/fix/pi-0.99-host-26` |
| `archive/pi-minimal-display/fix/quiet-tool-toggle` | branch | `2080bea` | `refs/heads/fix/quiet-tool-toggle` |
| `archive/pi-minimal-display/main` | branch | `310e361` | `refs/heads/main` |
| `archive/pi-minimal-display/refactor/native-thinking-config` | branch | `7c59205` | `refs/heads/refactor/native-thinking-config` |
| `archive/pi-minimal-display/refactor/presentation-disposer` | branch | `a158d7d` | `refs/heads/refactor/presentation-disposer` |
| `archive/pi-minimal-display/release/0.1.0` | branch | `7f69a46` | `refs/heads/release/0.1.0` |
| `archive/pi-minimal-display/test/release-candidate` | branch | `a65066a` | `refs/heads/test/release-candidate` |
| `archive/pi-minimal-display/pull-11` | tag | `c878c95` | `refs/pull/11/head` |
| `archive/pi-minimal-display/pull-13` | tag | `324ee3d` | `refs/pull/13/head` |
| `archive/pi-minimal-display/pull-15` | tag | `8dad308` | `refs/pull/15/head` |
| `archive/pi-minimal-display/pull-17` | tag | `2080bea` | `refs/pull/17/head` |
| `archive/pi-minimal-display/pull-19` | tag | `7c59205` | `refs/pull/19/head` |
| `archive/pi-minimal-display/pull-21` | tag | `1aede41` | `refs/pull/21/head` |
| `archive/pi-minimal-display/pull-23` | tag | `7f69a46` | `refs/pull/23/head` |
| `archive/pi-minimal-display/pull-25` | tag | `68e0d1a` | `refs/pull/25/head` |
| `archive/pi-minimal-display/pull-27` | tag | `2b552a0` | `refs/pull/27/head` |
| `archive/pi-minimal-display/pull-5` | tag | `b7956b3` | `refs/pull/5/head` |
| `archive/pi-minimal-display/pull-6` | tag | `abfe85e` | `refs/pull/6/head` |
| `archive/pi-minimal-display/pull-7` | tag | `a65066a` | `refs/pull/7/head` |
| `archive/pi-minimal-display/pull-9` | tag | `a158d7d` | `refs/pull/9/head` |
| `archive/pi-minimal-display/v0.1.0` | annotated tag (`0085b33`) | `77b6af7` | `refs/tags/v0.1.0` |
| `archive/pi-minimal-display/v0.1.1` | annotated tag (`42de735`) | `f407122` | `refs/tags/v0.1.1` |
| `archive/pi-minimal-display/v0.1.2` | annotated tag (`e1d7d8b`) | `310e361` | `refs/tags/v0.1.2` |
