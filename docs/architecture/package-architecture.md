# Package Architecture

Final architecture supporting relay (SBRP) now and P2P later.

## Design Principles

1. **Neutral core** — protocol, transport, runtime know nothing about topology
2. **Layered protocols** — SBP for application frames, SBRP/SBDP for session layers
3. **Clear boundaries** — each package has one job
4. **No premature abstraction** — P2P designed when needed, not before

## Terminology

| Term                  | Context        | Meaning                               |
| --------------------- | -------------- | ------------------------------------- |
| Cryptographic session | `secure-relay` | Key agreement state + encryption keys |
| Connection            | `runtime`      | Logical peer-to-peer link             |
| Peer session          | `peer` SDK     | User-facing connection abstraction    |

## Protocol Layers

Sideband uses a layered protocol architecture:

| Layer          | Protocol                            | Package                     | Purpose                                      |
| -------------- | ----------------------------------- | --------------------------- | -------------------------------------------- |
| App Framing    | **SBP** (Sideband Protocol)         | `@sideband/protocol`        | Application-level frames (topology-agnostic) |
| Relay Session  | **SBRP** (Sideband Relay Protocol)  | `@sideband/secure-relay`    | E2EE tunnel via relay server                 |
| Direct Session | **SBDP** (Sideband Direct Protocol) | `@sideband/direct` (future) | P2P session via DTLS or similar              |

**Relay mode:** SBRP wraps SBP. DATA frames contain encrypted SBP frames.

```
┌─────────────────────────────────────────┐
│  SBRP Frame (DATA)                      │
│  ┌───────────────────────────────────┐  │
│  │  Encrypted SBP Frame (Message)    │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  RPC Envelope / App Data    │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**P2P mode (future):** SBP frames secured via SBDP session layer (DTLS or application-layer auth).

## Layer Model

```
┌─────────────────────────────────────────────────────────┐
│  Layer 4: SDK                                           │
│  @sideband/peer                                         │
│  Composes runtime + session + transports                │
└─────────────────────────────────────────────────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          ▼                                   ▼
┌───────────────────────┐       ┌───────────────────────┐
│  Layer 3: Session     │       │  Layer 2: Coord       │
│  @sideband/           │       │  @sideband/runtime    │
│    secure-relay       │       │  @sideband/rpc        │
│  (future: p2p)        │       │                       │
└───────────────────────┘       └───────────┬───────────┘
          │                                 │
          │                     ┌───────────┴───────────┐
          │                     ▼                       ▼
          │           ┌───────────────┐       ┌───────────────┐
          │           │  Layer 1: I/O │       │  Layer 0      │
          │           │  @sideband/   │       │  @sideband/   │
          │           │    transport  │       │    protocol   │
          │           └───────────────┘       └───────────────┘
          │                     │
          │               ┌─────┴─────┐
          │               ▼           ▼
          │         ┌─────────┐ ┌─────────┐
          │         │ browser │ │  node   │
          │         └─────────┘ └─────────┘
          │
    (standalone: @noble/*)
```

Key insight: **Session layer and runtime are siblings.** Peer composes them; neither depends on the other.

## Package Reference

### Layer 0: Application Wire Contract

#### `@sideband/protocol` — Sideband Protocol (SBP)

Application-level framing. The "inner" protocol.

| Provides                                  | Does NOT provide   |
| ----------------------------------------- | ------------------ |
| Frame types: Control, Message, Ack, Error | I/O                |
| ControlOp: Handshake, Ping, Pong, Close   | Crypto             |
| Codecs: `encodeFrame()`, `decodeFrame()`  | Session management |
| Type guards                               | Tunnel framing     |

**Depends on:** none

### Layer 1: I/O

#### `@sideband/transport`

Abstract transport interface.

| Provides                        | Does NOT provide |
| ------------------------------- | ---------------- |
| `Transport` interface           | WebSocket impl   |
| `TransportConnection` interface | Crypto           |
| `MemoryTransport` (testing)     | Session logic    |

**Depends on:** protocol

#### `@sideband/transport-browser`

Browser WebSocket transport.

**Depends on:** protocol, transport

#### `@sideband/transport-node`

Node/Bun WebSocket transport.

**Depends on:** protocol, transport

### Layer 2: Coordination

#### `@sideband/runtime`

Transport-agnostic execution engine.

| Provides             | Does NOT provide       |
| -------------------- | ---------------------- |
| Peer lifecycle       | Concrete transports    |
| Transport attachment | Crypto                 |
| Message routing      | Topology knowledge     |
| Middleware hooks     | Session-specific logic |

**Depends on:** protocol, transport

#### `@sideband/rpc`

Request/response semantics.

| Provides           | Does NOT provide   |
| ------------------ | ------------------ |
| RPC envelope types | Delivery mechanism |
| Correlation IDs    | Encryption         |
| Subject namespaces |                    |

**Depends on:** protocol

### Layer 3: Session

#### `@sideband/secure-relay` — Sideband Relay Protocol (SBRP)

E2EE session layer for relay topology. Standalone — no runtime dependency.

| Provides                      | Does NOT provide  |
| ----------------------------- | ----------------- |
| Ed25519/X25519 key generation | WebSocket I/O     |
| Signed ephemeral key exchange | Transport logic   |
| ChaCha20-Poly1305 encryption  | Token issuance    |
| TOFU identity pinning         | Relay server impl |
| Replay protection             |                   |
| SBRP frame codecs             |                   |

Frame types: DATA, CONTROL, HANDSHAKE_INIT, HANDSHAKE_ACCEPT, PING, PONG, SIGNAL

**Depends on:** @noble/\* (crypto only)

> **Why standalone?** Pure crypto with no I/O deps improves testability, portability, and allows use outside Sideband.

#### Future: `@sideband/direct` — Sideband Direct Protocol (SBDP)

When P2P is needed, a separate session package with different primitives:

- ICE/STUN/TURN
- Signaling
- Direct peer auth (DTLS or application-layer)

Will wrap or directly use SBP frames, similar to how SBRP wraps SBP.

### Layer 4: SDK

#### `@sideband/peer`

User-facing API. Composes session + runtime + transport.

```ts
// Relay mode
const peer = new Peer({
  transport: browserTransport(),
  session: sbrpSession({ daemonId, pinnedKey }),
});

// P2P mode (future)
const peer = new Peer({
  transport: webrtcTransport(),
  session: directSession({ ... }),
});
```

| Provides                  | Does NOT provide    |
| ------------------------- | ------------------- |
| Simple connect/disconnect | Wire format details |
| Pub/sub helpers           | Crypto primitives   |
| RPC client                | Transport internals |

**Depends on:** runtime, rpc, transport-\*, secure-relay

### Tooling

#### `@sideband/cli`

Developer tools: key generation, inspection, debugging.

#### `@sideband/testing`

Test utilities: fakes, loopback transports, fixtures.

## Dependency Graph

```
@sideband/protocol (SBP)           @noble/* (crypto)
        │                                │
   ┌────┴────┬────────────┐              │
   ▼         ▼            ▼              │
transport  runtime     (used by)         │
   │         │            │              │
   └────►────┤            ▼              │
             ▼     secure-relay (SBRP) ◄─┘
            rpc           │
             │            │
             └─────┬──────┘
                   ▼
                  peer
                   │
             ┌─────┴─────┐
             ▼           ▼
            cli       testing
```

**Critical constraint:** `runtime` and `secure-relay` are **siblings**. Neither depends on the other. `peer` composes both.

## Integration: How Relay Mode Works

```
Browser                    Relay Server                   Daemon
   │                            │                            │
   │◄─── WebSocket (TLS) ──────►│◄─── WebSocket (TLS) ──────►│
   │                            │                            │
   │         SBRP frames        │        SBRP frames         │
   │◄──────────────────────────►│◄──────────────────────────►│
   │                            │                            │
   └────────────────────────────┼────────────────────────────┘
              E2EE tunnel (secure-relay)

   Inside DATA frames: encrypted SBP frames (protocol)
```

1. Transport layer: `transport-browser` / `transport-node` handle WebSocket
2. Session layer: `secure-relay` encrypts/decrypts, manages handshake
3. Application layer: `protocol` frames (Message, Control, etc.)
4. RPC layer: `rpc` envelopes inside Message frames
5. SDK layer: `peer` orchestrates everything

## Package List

### Ship now (10 packages)

| #   | Package                       | Layer | Description                                  |
| --- | ----------------------------- | ----- | -------------------------------------------- |
| 1   | `@sideband/protocol`          | 0     | Application framing & wire contract (SBP)    |
| 2   | `@sideband/transport`         | 1     | Abstract I/O interfaces                      |
| 3   | `@sideband/transport-browser` | 1     | Browser WebSocket adapter                    |
| 4   | `@sideband/transport-node`    | 1     | Node/Bun WebSocket adapter                   |
| 5   | `@sideband/rpc`               | 2     | RPC envelope & correlation                   |
| 6   | `@sideband/runtime`           | 2     | Coordination engine (routing, lifecycle)     |
| 7   | `@sideband/secure-relay`      | 3     | Cryptographic session layer for relay (SBRP) |
| 8   | `@sideband/peer`              | 4     | User-facing SDK                              |
| 9   | `@sideband/cli`               | Tool  | Developer tooling                            |
| 10  | `@sideband/testing`           | Tool  | Test utilities & fixtures                    |

### Add later (when P2P needed)

| Package                      | Description                |
| ---------------------------- | -------------------------- |
| `@sideband/transport-webrtc` | WebRTC DataChannel adapter |
| `@sideband/direct`           | P2P session layer (SBDP)   |

## Summary

- **SBP** (`protocol`) = application framing, topology-agnostic
- **SBRP** (`secure-relay`) = relay session layer, wraps SBP with E2EE
- **SBDP** (`direct`, future) = direct session layer for P2P
- **runtime** and session layers are siblings, composed by **peer**
