# Documentation

## Structure

| Layer             | Path              | Scope                                         |
| ----------------- | ----------------- | --------------------------------------------- |
| Wire protocols    | `protocols/`      | Frame encoding, state machines, cryptography  |
| Runtime contracts | `runtime/`        | Session lifecycle, routing, correlation       |
| SDK design        | `sdk/`            | Public API surface and design documents       |
| Decisions         | `adr/NNN-slug.md` | Architectural decisions, reference as ADR-NNN |
| Architecture      | `architecture/`   | Package design, repo structure                |
| Guides            | `guide/`          | Non-normative tutorials                       |

## Reference Conventions

Use doc references in code comments only when enforcing a non-obvious normative rule.

| Source           | Reference style            | Example                          |
| ---------------- | -------------------------- | -------------------------------- |
| ADR              | `ADR-NNN`                  | `// See ADR-004`                 |
| Protocol spec    | `docs/protocols/<path>.md` | `// See docs/protocols/stack.md` |
| Runtime contract | `docs/runtime/<slug>.md`   | `// See docs/runtime/session.md` |
| SDK contract     | `docs/sdk/<slug>.md`       | `// See docs/sdk/peer.md`        |

Never restate a normative rule in a comment — reference the authoritative source instead.

## Golden Rule

A normative rule MUST appear in exactly one document. `runtime/` and `sdk/` reference `protocols/` — they never restate wire rules. `docs/protocols/stack.md` is the final arbiter on layer boundaries.

## Reference Direction

```
protocols/      ← independent; no upstream dependencies
runtime/        ← may reference protocols/
sdk/            ← may reference runtime/ and protocols/
architecture/   ← may reference protocols/
adr/            ← may reference all layers
guide/          ← may reference all layers
```

See `docs/protocols/authoring.md` for protocol-specific documentation guidelines.
