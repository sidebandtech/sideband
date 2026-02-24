# Changesets

Changeset files in this folder describe pending version bumps. Each `.md` file represents one change.

## Commands

```bash
bun run changeset     # Create a changeset (interactive)
bun run version       # Apply changesets → bump versions + generate changelogs
bun run release       # Build + publish to npm
```

## Creating a changeset

Run `bun run changeset` and answer:

1. Which packages changed? (space to select)
2. Semver bump type: `patch` (fix), `minor` (feature), `major` (breaking)
3. Summary of the change

This creates a file like `.changeset/peer-sdk-alpha.md`:

```md
---
"@sideband/peer": minor
"@sideband/runtime": patch
---

Add typed RPC proxy and reconnection buffering to peer SDK
```

## When to create changesets

- **Yes**: Bug fixes, new features, breaking changes, dependency updates affecting consumers
- **No**: Docs-only changes, internal refactors, test changes, CI updates

## Semver guidelines

| Change                             | Bump    | Example                            |
| ---------------------------------- | ------- | ---------------------------------- |
| Bug fix                            | `patch` | Fix reconnect loop not backing off |
| New feature (backwards compatible) | `minor` | Add typed RPC proxy to peer SDK    |
| Breaking change                    | `major` | Rename `connect()` to `open()`     |
| Dependency bump (non-breaking)     | `patch` | Update transport peer dep range    |

## Links

- [Changesets documentation](https://github.com/changesets/changesets)
- [Common questions](https://github.com/changesets/changesets/blob/main/docs/common-questions.md)
