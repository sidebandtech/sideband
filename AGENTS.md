## Documentation

See `docs/README.md` for structure, reference conventions, and the authority model. ADRs are referenced as ADR-NNN.

## Constraints

- Core must stay transport-agnostic.
- `@sideband/protocol` has no I/O or runtime logic.
- Transports depend only on `@sideband/protocol`, never on core/rpc/client.
- Public APIs favor correctness, simplicity, and strong typing over features.
- Follow roles and dependencies in `docs/architecture/project-structure.md`.

## Stack

Bun >= 1.3 · TypeScript >= 5.9 · ESM · Prettier + ESLint (double quotes, semicolons)

`docs/architecture/project-structure.md`
`docs/adr/002-naming-matrix.md`

@AGENTS.local.md
