# SDK Design

> **Authority**: Navigation (non-normative)  
> **Purpose**: Index and layer boundary for public SDK contracts and design documents.

The `sdk/` layer covers the public API surface of `@sideband/peer` and related consumer-facing packages. It sits above the runtime layer and does not define wire encoding or session cryptography.

SDK docs may reference `runtime/` for behavioral contracts and `protocols/` for wire invariants. They MUST NOT restate rules defined in those layers.

## Documents

| Document             | Scope                                                   | Status |
| -------------------- | ------------------------------------------------------- | ------ |
| [peer.md](./peer.md) | Peer SDK API design, lifecycle, pub/sub, error handling | Active |

## Layer Boundary

| Concern                               | Authority                                     |
| ------------------------------------- | --------------------------------------------- |
| Public API surface (`@sideband/peer`) | This layer                                    |
| Session lifecycle and negotiators     | [`runtime/session.md`](../runtime/session.md) |
| Message routing and dispatch          | [`runtime/router.md`](../runtime/router.md)   |
| Frame encoding                        | [`protocols/sbp/`](../protocols/sbp/)         |
| E2EE handshake                        | [`protocols/sbrp/`](../protocols/sbrp/)       |
| RPC envelope structure                | [`protocols/rpc/`](../protocols/rpc/)         |
