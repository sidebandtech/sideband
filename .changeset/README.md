# Changesets

This folder is used by [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

## Adding a changeset

```bash
bun changeset
```

Follow the prompts to select packages and describe your changes.

## Releasing

The release workflow automatically creates a "Version Packages" PR when changesets exist on `main`. Merging that PR triggers publishing to npm.
