# Changesets

Each package in `packages/` is versioned and published independently. Add a changeset
only for the packages a change actually affects:

```sh
npm run changeset
```

`npm run version-packages` applies pending changesets and refreshes the root lockfile.
Publishing runs from the manually triggered release workflow, never from a local shell.
