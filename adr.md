---
url: /adr.md
---
# Architecture Decision Records

This section documents significant architectural decisions for the Sideband project. Each ADR captures the context, decision, and consequences of a choice that affects the codebase.

## Index

| ADR                                                   | Title                                 | Status   |
| ----------------------------------------------------- | ------------------------------------- | -------- |
| [001](./001-protocol-versioning-and-compatibility.md) | Protocol Versioning and Compatibility | Accepted |
| [002](./002-naming-matrix.md)                         | Naming Matrix for Protocol Types      | Accepted |
| [003](./003-control-frame-invariants.md)              | Control Frame Invariants              | Accepted |
| [004](./004-binary-frameid.md)                        | Binary FrameId                        | Accepted |
| [005](./005-transport-abi.md)                         | Transport ABI                         | Accepted |
| [006](./006-rpc-envelope.md)                          | RPC Envelope                          | Accepted |
| [007](./007-immutable-frame-types.md)                 | Immutable Frame Types                 | Accepted |
| [008](./008-subject-namespace-validation.md)          | Channel Subject Validation            | Accepted |
| [009](./009-runtime-peer-lifecycle.md)                | Runtime Session Lifecycle             | Accepted |
| [010](./010-rpc-correlation-cid.md)                   | RPC Correlation with CID              | Accepted |
| [011](./011-runtime-message-routing.md)               | Runtime Message Routing               | Accepted |
| [012](./012-websocket-transport-design.md)            | WebSocket Transport Design Decisions  | Accepted |
| [013](./013-peer-sdk-design.md)                       | Peer SDK Core Design Decisions        | Accepted |
| [014](./014-peer-session-signals.md)                  | Peer SDK Session Signal Handling      | Accepted |
| [015](./015-p2p-direct-protocol.md)                   | P2P Direct Protocol (SBDP)            | Accepted |
| [016](./016-relay-server-design.md)                   | Relay Server Design                   | Accepted |
| [017](./017-cloud-sdk-design.md)                      | Cloud SDK Design                      | Accepted |
| [018](./018-daemon-capabilities.md)                   | Daemon Built-in Capabilities          | Accepted |

## Creating a new ADR

Copy [\_template.md](./_template.md) and follow the format. Number ADRs sequentially.
