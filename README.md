# Pi Extensions

[![Check](https://github.com/AllenYolk/pi-extensions/actions/workflows/check.yml/badge.svg)](https://github.com/AllenYolk/pi-extensions/actions/workflows/check.yml)

AllenYolk's personal [Pi](https://pi.dev) extensions. Each package solves one focused problem
and can be installed, updated and used independently.

| Package | What it does |
| --- | --- |
| [`@allenyolk/pi-delete`](packages/pi-delete/README.md) | Delete the current session and exit, optionally including its descendants; delete a subtree from Pi's session picker. |
| [`@allenyolk/pi-minimal-display`](packages/pi-minimal-display/README.md) | Group tool activity into compact cards, with native details available on expansion. |
| [`@allenyolk/pi-compaction`](packages/pi-compaction/README.md) | Give the compaction summarizer its own model and thinking level, and never persist a summary that is not whole. Inert until you enable it. |

## Install

Install the package you want. This is the recommended route, and the packages update
independently:

```sh
pi install npm:@allenyolk/pi-delete
pi install npm:@allenyolk/pi-minimal-display
pi install npm:@allenyolk/pi-compaction
```

Or install this repository as one collection, which enables all three:

```sh
pi install git:github.com/AllenYolk/pi-extensions
```

**The collection ships a third extension, and it is inert until you explicitly enable it.**
`@allenyolk/pi-compaction` reads `extensions/pi-compaction/config.json` in the Pi agent directory,
where `enabled` defaults to `false`. Installing or updating the collection therefore changes nobody's
compaction: until you set that field or run `/compaction enable`, compaction is exactly what stock Pi
does. Enabling it is the only step that hands compaction to this package, and `/compaction disable`
hands it straight back.

To take only one extension from the collection, narrow it in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/AllenYolk/pi-extensions",
      "extensions": ["packages/pi-minimal-display/src/index.ts"]
    }
  ]
}
```

Pick one route per extension. Installing an extension from both npm and this collection loads
it twice; remove the declaration you are replacing and restart. Pinning a tag or commit keeps
that ref — `pi update --extensions` reconciles the checkout but does not move a pinned ref.

Each package README documents its own configuration, behaviour and recovery.

## Theme presets

[calm](themes/calm/README.md) keeps Pi's native compact editor with a gray-blue border
and offers an optional, understated `@narumitw/pi-starship` configuration. It is one
self-contained theme unit with its own upstream license; copy and activate its files
explicitly. No new npm package or collection manifest entry is added.

## Repository layout

```text
packages/pi-delete/           Package, README, source and tests
packages/pi-minimal-display/  Package, README, source and tests
packages/pi-compaction/       Package, README, source, tests and ADRs
test/                        Installation and coexistence checks
docs/                        Contributor conventions and archived history
```

The root is a private npm workspace, not a package of its own. Packages keep their own
versions, licenses and manifests; they share no runtime code and none depends on another.

## Development

```sh
npm ci --ignore-scripts
uv python install 3.12   # the PTY probes use the Python standard library
npm run check
```

`npm run check` runs each package's own checks and then the collection checks in `test/`,
which cover git installation with resource filtering and all three extensions loaded in one
session. The checks use disposable profiles under ignored `work/` and never touch the daily
Pi profile or real sessions.

Each package keeps the Pi version it certifies as its own development dependency, so the
different hosts stay installed side by side. TypeScript is shared at the root.

Versions are managed with [Changesets](.changeset/README.md); only the packages a change
affects get a bump. Publishing runs from a manually triggered workflow on `main`.

Pull requests run the checks above and receive an OpenCodeReview review. Maintainers can
comment `/ocr` to rerun it after changes. Automated findings supplement the checks and human
review; see [CONTRIBUTING.md](CONTRIBUTING.md#pull-request-review) for setup and review rules.

Agents start with [AGENTS.md](AGENTS.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for the issue, review and release gates,
[CONTEXT.md](CONTEXT.md) for the shared vocabulary, and [docs/migration.md](docs/migration.md)
for why this repository exists and what the move away from two repositories cost.

## License

Extension packages: [MIT](LICENSE), copyright AllenYolk. The OCR workflow, completion guard
and guard regression test adapted from [SpikingJelly](https://github.com/fangwei123456/spikingjelly)
retain [Apache-2.0](LICENSES/Apache-2.0.txt). Pi and its dependencies retain their own licenses.
