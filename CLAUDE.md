# Sideband – Bun-first P2P stack

Goal: build a small, composable P2P communication stack for Bun/TypeScript apps:  
protocol → core runtime → RPC → client SDK → browser/node transports → CLI.

## Documentation

**ADRs** (`docs/adr/NNN-slug.md`): Architectural decisions (reference as ADR-NNN)  
**SPECs** (`docs/specs/slug.md`): Component specifications (reference as docs/specs/slug.md)

## Constraints

- Core must stay transport-agnostic.
- `@sideband/protocol` has no I/O or runtime logic.
- Transports depend only on `@sideband/protocol`, never on core/rpc/client.
- Public APIs favor correctness, simplicity, and strong typing over features.
- Follow roles and dependencies in `docs/architecture/project-structure.md`.

## Configuration

- **Runtime**: Bun >= 1.3
- **Language**: TypeScript >= 5.9
- **Module System**: ES modules
- **Style**: Prettier + ESLint, double quotes, semicolons
- **Package Management**: Bun workspaces
- **Strict Mode**: Full strict TypeScript with additional safety checks
- **Project Structure**: @docs/architecture/project-structure.md
- **Glossary and naming**: @docs/adr/002-naming-matrix.md @docs/glossary.md
