---
url: /adr/018-daemon-capabilities.md
---
# ADR-018: Daemon Built-in Capabilities and `$sideband/*` Namespace

* **Date**: 2026-03-07
* **Status**: Accepted
* **Affects**: SDK, CLI

## Context

The connect page needs something meaningful to render when a peer connects. Before this PR the daemon had only two methods (`$sideband/echo`, `$sideband/info`) with no introspection surface and no way for a UI to discover what a daemon can do. Three design questions arose:

1. **How should a UI discover which RPC methods exist?** — enumerating all handlers vs. a dedicated introspection protocol.
2. **How should user-facing features (stats, future file browser) be advertised?** — a free-form capability bag vs. a fixed schema.
3. **Where does method introspection belong in the SDK?** — a separate introspection API vs. a method on `RpcInterface`.

## Decision

### 1. `$sideband/*` — reserved namespace for platform-provided handlers

All handlers registered by the Sideband platform (CLI built-ins, SDK infrastructure) use the `$sideband/` prefix. User-registered methods MUST NOT use this prefix.

This makes the platform surface unambiguous and lets UIs apply consistent treatment (e.g., grouping, filtering) without heuristics.

### 2. Two-tier introspection: infrastructure vs. capabilities

**Infrastructure handlers** (`$sideband/rpc.list`, `$sideband/rpc.describe`) are always available on every daemon, CLI or programmatic. They are universal and are NOT listed in `capabilities` — their presence is implicit.

**Capabilities** (`stats`, future `fs`) represent user-facing functional areas that may or may not be present. They are advertised explicitly in `$sideband/info`:

```typescript
// $sideband/info response
{
  daemonId: string;
  name: string;
  version: string;
  capabilities: Record<string, object>; // { stats: {}, fs: { root, write } … }
}
```

The key design invariant: **`rpc.list` is the truth; `rpc.describe` is optional display metadata; `capabilities` is the user-feature contract.**

Rationale for the separation:

* `rpc.list` returns all registered methods — including user-defined ones. The UI uses it for the full method set.
* `capabilities` is a curated, stable API for feature detection. A UI checking `capabilities.stats` is more robust than checking whether `$sideband/stats` appears in `rpc.list`.
* `rpc.describe` is sparse metadata for human display. It is intentionally not filtered against `rpc.list` — undescribed methods appear in `rpc.list` but not in `rpc.describe`, which is correct and expected.

### 3. `listMethods()` on `RpcInterface`

Method introspection is placed on `RpcInterface` rather than a separate API:

```typescript
interface RpcInterface {
  listMethods(): string[]; // Returns registered handler names, sorted lexicographically.
}
```

**Rationale:** `$sideband/rpc.list` must work for every daemon — CLI and programmatic. Placing `listMethods()` on `RpcInterface` means any daemon, regardless of how it was created, exposes the same introspection surface. A separate top-level introspection API would require daemon authors to opt in explicitly; an `RpcInterface` method is always there.

### 4. Stats subscriptions are session-scoped

`$sideband/stats.start` subscriptions are not resumed across reconnects. The client must call `stats.start` again after a new session is established. Rationale: resuming a subscription requires the daemon to track per-client state across sessions, which adds complexity and creates implicit cleanup obligations. Explicit restart is simpler, predictable, and keeps the daemon stateless between sessions.

## Invariants

* `$sideband/*` prefix is reserved for platform use. User handlers MUST NOT use it.
* `rpc.list` and `rpc.describe` MUST NOT appear in `capabilities`.
* `listMethods()` returns a sorted array — clients may rely on lexicographic order for stable display.
* Stats subscriptions are terminal at session end — not resumed on reconnect.

## Consequences

* UI can use `capabilities` for feature detection and `rpc.list` + `rpc.describe` for the RPC explorer.
* New CLI capabilities (e.g., `fs`) follow the same pattern: register handlers, return `{ fs: <descriptor> }` from the handler registrar, merge into `$sideband/info`.
* Programmatic daemons that want `rpc.list` to work correctly call `registerRpcMeta()` themselves; it is opt-in, not automatic.

## References

* ADR-013: Peer SDK Core Design Decisions
* `packages/cli/src/handlers/rpc-meta.ts` — `registerRpcMeta()`
* `packages/cli/src/handlers/stats.ts` — `registerStatsHandlers()`
* `packages/peer/src/types.ts` — `RpcInterface.listMethods()`
