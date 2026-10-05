# Pi Extensions

Source repository for two independent Pi extensions. They share this repository and its
engineering setup; they share no runtime code and neither depends on the other.

| Package | What it does |
| --- | --- |
| [`@allenyolk/pi-delete`](packages/pi-delete) | `/delete` removes the current session and exits, optionally cascading to the sessions forked or spawned from it. Adds a subtree delete to Pi's session picker. |
| [`@allenyolk/pi-minimal-display`](packages/pi-minimal-display) | Compact, expandable tool cards with reversible presentation patches and native expansion. |

## Install

Install the package you want. This is the recommended route, and the two packages update
independently:

```sh
pi install npm:@allenyolk/pi-delete
pi install npm:@allenyolk/pi-minimal-display
```

Or install this repository as one collection, which enables both:

```sh
pi install git:github.com/AllenYolk/pi-extensions
```

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

## Development

```sh
npm ci --ignore-scripts
uv python install 3.12   # the PTY probes use the Python standard library
npm run check
```

`npm run check` runs each package's own checks and then the collection checks in `test/`,
which cover git installation with resource filtering and both extensions loaded in one
session. The checks use disposable profiles under ignored `work/` and never touch the daily
Pi profile or real sessions.

Each package keeps the Pi version it certifies as its own development dependency, so the two
different hosts stay installed side by side. TypeScript is shared at the root.

Versions are managed with [Changesets](.changeset/README.md); only the packages a change
affects get a bump. Publishing runs from a manually triggered workflow on `main`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the issue, review and release gates,
[CONTEXT.md](CONTEXT.md) for the shared vocabulary, and [docs/migration.md](docs/migration.md)
for why this repository exists and what the move away from two repositories cost.

## License

MIT, copyright AllenYolk. Pi and its dependencies retain their respective licenses.
