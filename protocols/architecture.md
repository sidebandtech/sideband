---
url: /protocols/architecture.md
---
# Protocol Architecture

> **Authority**: Primary (Normative)\
> **Purpose**: Layer boundaries, frame wrapping rules, and dependency invariants. Final arbiter when layer specs conflict.

This document defines frame wrapping rules, dependency invariants, and layer boundaries. Lower-level details (frame encoding, cryptography, RPC envelopes) are documented in referenced specifications. This document is the final arbiter of layer architecture; conflicts indicate bugs in lower-level specs which MUST be updated to comply.

## Document Conventions

* **Normative**: Sections using MUST/SHOULD/MAY define required behavior
* **Non-normative**: Examples, notes, and diagrams illustrate but do not constrain implementations

## Layer Stack

```text
┌─────────────────────────────────────────────────────────────────────┐
│  Application / SDK                                                  │
│  (@sideband/peer, @sideband/cli)                                    │
├─────────────────────────────────────────────────────────────────────┤
│  RPC Layer                                                          │
│  Typed request/response/notification semantics                      │
│  Lives inside: MessageFrame.data                                    │
├─────────────────────────────────────────────────────────────────────┤
│  SBP (Sideband Protocol)                                            │
│  Application framing: Control, Message, Ack, Error                  │
│  Topology-agnostic, no encryption, no transport                     │
├─────────────────────────────────────────────────────────────────────┤
│  Session Layer                                                      │
│  ├─ SBRP (relay mode): E2EE via relay server                        │
│  └─ SBDP (direct mode): P2P encryption (future)                     │
├─────────────────────────────────────────────────────────────────────┤
│  Transport                                                          │
│  Any ordered transport with integrity (WebSocket, QUIC streams)     │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow (Non-normative)

When a client sends an RPC request through a relay:

```text
1. Application creates RPC request     →  { t: "r", m: "getUser", p: {...} }
2. RPC encodes to JSON (default) or CBOR →  bytes
3. SBP wraps in MessageFrame           →  [header][frameId][subject][data]
4. SBRP encrypts complete SBP frame    →  [nonce][ciphertext][authTag]
5. SBRP wraps in Data frame (0x03)     →  [type][length][sessionId][encrypted]
6. Transport sends over WebSocket      →  binary message
```

Encoding is negotiated during handshake via capabilities (default: JSON). The encrypted blob in step 4 contains the full SBP frame bytes (header + frameId + payload).

## Frame Wrapping Rules

These rules are normative. Violations indicate implementation bugs.

### Rule 1: SBP Frames Are Application-Visible

SBP frames (`ControlFrame`, `MessageFrame`, `AckFrame`, `ErrorFrame`) are the only frames that application code interacts with. Session layers and transports are invisible to applications.

### Rule 2: Session Layers Treat SBP Frames as Opaque Payloads

SBRP and SBDP MUST treat the entire SBP frame (including header, frameId, and payload) as an opaque byte sequence. Session layers:

* MUST NOT parse SBP frame structure
* MUST NOT inspect MessageFrame subjects or data
* MUST NOT depend on SBP semantics for routing decisions
* MUST NOT rewrite any SBP frame field (including frameId)

**SBRP Data frames (type 0x03) carry encrypted SBP frames.** This includes SBP `ControlFrame` (handshake, ping, pong), `MessageFrame` (application data), `AckFrame`, and `ErrorFrame`. After decryption, endpoints deserialize the plaintext using `@sideband/protocol` codecs. SBRP never inspects encrypted payload contents.

**Forwarding invariant**: SBRP relays forward encrypted SBP frames without modification; they never terminate SBP links. If a separate component (an SBP proxy) terminates an SBP link and re-originates frames on a new link, it MUST generate new frameIds on the outbound link—this creates two back-to-back SBP sessions, not frame forwarding.

### Rule 3: RPC Envelopes Are Invisible to All Lower Layers

RPC envelopes exist only inside `MessageFrame.data`. They are:

* Invisible to SBP framing (SBP routes by `subject` but does not interpret `data` contents)
* Invisible to session layers (which see encrypted SBP frames)
* Invisible to transports (which see binary messages)

### Rule 4: Frame Identity Is Layer-Scoped

| Layer | Identity Field | Wire Key | Scope                     | Reused Across Layers? |
| ----- | -------------- | -------- | ------------------------- | --------------------- |
| SBP   | `frameId`      | `id`     | Sender-local unique       | No                    |
| SBRP  | `SessionID`    | (header) | Relay routing multiplexer | No                    |
| RPC   | `cid`          | `cid`    | End-to-end correlation    | No                    |

**frameId**: Identifies frames at their origin; never rewritten by SBRP relays (see Rule 2). Used for Ack linkage within a single SBP link. Receivers MUST NOT reuse a received frameId in outbound frames. AckFrame generation MAY be performed by the runtime on behalf of the application.

**cid**: RPC correlation ID copied from request to response. Preserved end-to-end through relays. Enables multi-hop routing while keeping SBP topology-agnostic.

**SessionID**: SBRP-specific uint64 in frame headers for relay multiplexing. Distinct from JWT `sid` claim used for authentication (see Session terminology below).

See ADR-010 for detailed rationale on frameId vs cid separation.

## Dependency Invariants

These invariants MUST be preserved. Violations require an ADR to justify.

### SBP Dependencies

SBP MUST NOT depend on:

* Session layer semantics (SBRP, SBDP)
* Transport guarantees (ordering, delivery)
* RPC envelope structure

SBP MAY be used directly over any byte-stream transport without a session layer (e.g., loopback testing, trusted networks).

### RPC Dependencies

RPC MUST NOT depend on:

* Session layer semantics
* Transport guarantees
* Encryption status (RPC works identically encrypted or plaintext)

RPC depends only on SBP `MessageFrame` for framing.

### Session Layer Dependencies

SBRP and SBDP:

* MUST NOT inspect SBP payload contents
* MUST NOT depend on RPC semantics
* MUST NOT initiate SBP frames (application or runtime generates all SBP frames)
* MUST treat received SBP frames as opaque and forward unchanged
* MAY have their own control messages (e.g., SBRP `RelayNotification` frames) that are session-layer scoped, not SBP-scoped

### Transport Dependencies

Transports (`@sideband/transport-*`):

* MUST NOT assume SBP semantics
* MUST NOT parse any layer above raw bytes
* MUST NOT generate frames for any layer

### Session Output Contract (Normative)

A session protocol (e.g., SBRP, SBDP) MUST present the runtime with a channel that:

1. Delivers complete, decrypted SBP frames on the inbound path
2. Accepts outbound SBP frames for encryption and transmission

This contract may be implemented:

* **Via Negotiator**: The `Negotiator.negotiate()` method returns a `NegotiationResult` with an optional `channel` field. If provided, the runtime uses this wrapped connection for all subsequent frame I/O. The negotiator handles key exchange and returns a channel that transparently encrypts/decrypts.
* **Via Transport Adapter**: A custom transport embeds session logic internally, exposing decrypted SBP frames directly. This approach is simpler but couples session and transport layers.

The runtime MUST NOT depend on which implementation approach is used. Both satisfy the contract.

## Error Code Ownership

See [Error Code Registry](./error-codes.md) for the canonical code definitions.

| Range       | Owner    | Carrier     | Purpose                          |
| ----------- | -------- | ----------- | -------------------------------- |
| 1000–1099   | SBP      | ErrorFrame  | Frame/handshake/namespace faults |
| 1100–1199   | RPC      | RpcError    | Envelope/method/routing faults   |
| 1200–1999   | Reserved | —           | Future protocol extensions       |
| 2000+       | App      | RpcError    | User-defined application errors  |

Implementations MUST NOT define codes outside their owned range.

SBRP uses a separate Control code namespace (0x01xx–0x10xx); these are not SBP/RPC error codes.

## Error Scope and Transport Authority

Error scope is determined by wire carrier:

* **SBP `ErrorFrame` (kind=3)**: Connection-scoped. Receivers apply fatality rules per `sbp/errors.md`.
* **RPC `RpcError` (t="E")**: Request-scoped. MUST NOT trigger transport close.

### Escalation

Errors that cannot be routed to a request are connection-scoped by definition. If an RPC envelope cannot be parsed or correlated, emit `ErrorFrame`; receivers apply fatality rules per `sbp/errors.md`. If the envelope is valid but the method fails, respond with `RpcError`.

## Terminology Disambiguation

### "Control" at Different Layers

Two distinct constructs use "Control" terminology:

| Layer | Construct           | Wire Type | Encrypted? | Purpose                         |
| ----- | ------------------- | --------- | ---------- | ------------------------------- |
| SBP   | `ControlFrame`      | kind=0    | Yes (E2EE) | Handshake, Ping, Pong, Close    |
| SBRP  | `RelayNotification` | 0x20      | Never      | Relay-to-endpoint notifications |

These are unrelated:

* **SBP ControlFrame**: Application-level protocol control (peer handshake, keepalive). Travels end-to-end inside SBRP Data frames, encrypted.
* **SBRP RelayNotification**: Relay-generated notifications (`session_paused`, `rate_limited`). Sent plaintext from relay to endpoint only. (Wire type 0x20; historically called "Control frame" but renamed to avoid confusion with SBP ControlFrame.)

### "Session" at Different Layers

The unqualified term "session" is ambiguous and SHOULD NOT be used in specifications or code. Use these qualified terms:

| Context             | Qualified Term | Type / Encoding         | Meaning                                         |
| ------------------- | -------------- | ----------------------- | ----------------------------------------------- |
| SBRP wire format    | `SessionID`    | uint64 (big-endian)     | Relay routing multiplexer; wire layer only      |
| SBRP authentication | `SessionToken` | JWT with `sid` claim    | Auth binding; relay validates against SessionID |
| SBRP cryptography   | `SessionState` | Binary (keys, counters) | E2EE encryption per client; endpoint-only       |
| SBP                 | (none)         | —                       | SBP has no session concept                      |

The JWT `sid` claim is the base64url-encoded 8-byte representation of SessionID uint64, enabling relays to validate that client frames' SessionID field matches the token.

### "Handshake" at Different Layers

| Layer | Construct                   | Wire Type    | Encrypted? | Purpose                                  |
| ----- | --------------------------- | ------------ | ---------- | ---------------------------------------- |
| SBP   | ControlFrame (op=Handshake) | kind=0, op=0 | Yes (E2EE) | Peer introduction (peerId, capabilities) |
| SBRP  | HandshakeInit/Accept        | 0x01, 0x02   | Never      | E2EE key exchange (X25519/Ed25519)       |

These are unrelated:

* **SBP Handshake**: Application-level peer introduction. Sent encrypted end-to-end within SBRP Data frames once a secure SBP-carrying channel is established.
* **SBRP Handshake**: Cryptographic key exchange. Sent plaintext during E2EE channel establishment. Relay forwards without inspection.

### "Ping/Pong" at Different Layers

| Layer | Construct        | Encrypted? | Purpose                             | Forwarded? |
| ----- | ---------------- | ---------- | ----------------------------------- | ---------- |
| SBP   | `ControlOp.Ping` | Yes (E2EE) | Application-level keepalive         | Yes        |
| SBRP  | `Ping` (0x10)    | Never      | Connection-level liveness detection | Never      |

SBP Ping/Pong are routable like Messages and encrypted by session layers for end-to-end liveness detection. SBRP Ping/Pong are unencrypted and connection-scoped.

## Session Resumption

Session resumption semantics differ by role:

| Role   | Resumption Support | Behavior                                         |
| ------ | ------------------ | ------------------------------------------------ |
| Client | Not supported      | Reconnect requires full handshake (new token)    |
| Daemon | SBRP only          | Resumable via `Signal(ready)` state machine      |

Runtime core does not require resumable sessions. Specific session layers (e.g., SBRP) MAY define resumable session semantics. When using SBRP, the session implementation (via negotiator-provided channel or transport adapter) MUST implement the SBRP pause/pending/resume state machine; other session implementations MAY ignore resume entirely.

## Registries

Canonical sources of truth for protocol constants:

| Registry         | Location                                       | Purpose                          |
| ---------------- | ---------------------------------------------- | -------------------------------- |
| Error codes      | [error-codes.md](./error-codes.md)             | All SBP/RPC error codes          |
| Subject prefixes | [rpc/envelope.md](./rpc/envelope.md)           | Reserved subject namespaces      |
| Capability names | [sbp/behavior.md](./sbp/behavior.md)           | Handshake capability strings     |
| SBRP controls    | [sbrp/control-codes.md](./sbrp/control-codes.md) | Relay notification codes       |

Specifications MUST reference registries; they MUST NOT define constants inline.

## v1 Invariants

Properties guaranteed in v1 that implementations may rely on:

1. **frameId is always present**: Every SBP frame has a 16-byte frameId, auto-generated at construction.
2. **Session layers are opaque**: Applications never see SBRP/SBDP framing.
3. **Relay is a frame router**: SBRP relay inspects SBRP frame headers (type, length, SessionID) for routing. It never parses encrypted payloads, SBP frames, or RPC envelopes.
4. **Best-effort delivery**: SBP allows senders to request Ack frames, but neither sending nor acknowledging is mandatory. Reconnection may cause retries at higher layers. Applications requiring reliable delivery must implement idempotency via RPC correlation.
5. **No guaranteed ordering**: Message ordering depends on transport. Relays and networks may reorder. Applications requiring strict ordering must add sequence numbers.

## Non-Goals (Explicit Deferrals)

These are intentionally not addressed in v1:

1. **Client cryptographic identity**: Clients use ephemeral keys; no persistent client signing keys.
2. **Streaming RPC**: `stream/` subject prefix is reserved but unspecified.
3. **Multi-hop relay chains**: Single relay only.
4. **Cross-session message correlation**: Each session is independent.
5. **SBDP implementation**: Design principles documented; full spec deferred.

## Related Documents

| Document                                                      | Authority              | Purpose                                |
| ------------------------------------------------------------- | ---------------------- | -------------------------------------- |
| [SBP Specification](./sbp/)                                   | Normative (SBP layer)  | Frame encoding, wire format, routing   |
| [SBRP Specification](./sbrp/)                                 | Normative (SBRP layer) | Session crypto, relay responsibilities |
| [SBDP Specification](./sbdp/)                                 | Design only (future)   | P2P session layer principles           |
| [RPC Specification](./rpc/)                                   | Normative (RPC layer)  | Envelope format, correlation           |
| [ADR-002: Naming Matrix](../adr/002-naming-matrix.md)         | Canonical              | Type/field names across all layers     |
| [ADR-009: Session Lifecycle](../adr/009-runtime-peer-lifecycle.md) | Canonical         | Negotiator interface, session states   |
| [ADR-010: RPC Correlation](../adr/010-rpc-correlation-cid.md) | Canonical              | frameId vs cid semantics               |
| [ADR-011: Message Routing](../adr/011-runtime-message-routing.md) | Canonical           | Router, handler dispatch               |

**Authority hierarchy**: This document defines intended layering and dependencies. Conflicts indicate bugs; lower-level specs MUST be updated to comply. This document is updated only if the architecture itself changes.
