# ADR 009: Runtime Session Lifecycle

- **Date**: 2025-01-11
- **Status**: Accepted
- **Applies to**: Runtime
- **Tags**: runtime, session, negotiation, lifecycle

## Context

The runtime must manage connections throughout their lifecycle. However, Sideband supports multiple protocol modes:

- **SBP (direct)**: Simple handshake-first exchange
- **SBRP (relay)**: E2EE with HandshakeInit/Accept, TOFU identity pinning, key derivation

A single hardcoded lifecycle won't age well. We need an architecture that:

1. Separates transport (bytes) from session (secure channel) from routing (dispatch)
2. Makes protocol-specific negotiation pluggable
3. Distinguishes logical peer identity from physical session
4. Allows per-transport retry policies

## Decision

### 1. Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Router                           │
│              (dispatches frames to handlers)            │
└────────────────────────┬────────────────────────────────┘
                         │ MessageFrame
┌────────────────────────┴────────────────────────────────┐
│                       Session                           │
│         (active channel, protocol-negotiated)           │
│                                                         │
│  ┌─────────────────┐    ┌─────────────────────────┐    │
│  │ SbpNegotiator   │ OR │ Custom Negotiator       │    │
│  │ (handshake)     │    │ (user-provided)         │    │
│  └─────────────────┘    └─────────────────────────┘    │
└────────────────────────┬────────────────────────────────┘
                         │ Uint8Array
┌────────────────────────┴────────────────────────────────┐
│                      Transport                          │
│            (connects, sends/receives bytes)             │
└─────────────────────────────────────────────────────────┘
```

**Boundaries:**

| Layer     | Responsibility                          | Does NOT handle            |
| --------- | --------------------------------------- | -------------------------- |
| Transport | Connection, byte streams                | Framing, security, routing |
| Session   | Negotiation, encryption, session state  | Message dispatch, handlers |
| Router    | Handler registry, dispatch, correlation | Connection management      |

### 2. Peer vs Session

These are distinct concepts:

| Concept      | Type                | Meaning                                                   | Lifetime                         |
| ------------ | ------------------- | --------------------------------------------------------- | -------------------------------- |
| **Peer**     | `Peer`              | Logical remote entity                                     | Long-lived, survives reconnects  |
| **Session**  | `Session`           | Active channel to peer                                    | Transient, replaced on reconnect |
| **peerId**   | `PeerId`            | Routing label                                             | Stable per peer                  |
| **identity** | `VerifiedIdentity?` | Cryptographic identity (e.g., Ed25519 pubkey fingerprint) | Set by negotiator, used for TOFU |

In SBRP, TOFU pins the daemon's identity key, not the peerId. The runtime exposes both:

```ts
interface Session {
  peerId: PeerId; // Routing label (from handshake)
  identity?: VerifiedIdentity; // Cryptographic identity (from negotiator)
  state: SessionState; // Observable lifecycle state
  channel: SessionChannel; // I/O channel (raw or wrapped)
  sendFrame(frame: Frame): Promise<void>; // Preferred: type-safe, encodes frame
  sendRaw(data: Uint8Array): Promise<void>; // Advanced: raw bytes (escape hatch)
}

// VerifiedIdentity is negotiator-specific
type VerifiedIdentity = {
  type: "ed25519";
  fingerprint: string; // Hex of pubkey hash
};
```

Note: `state` is intentionally exposed for observability (logging, UI indicators). Application code SHOULD NOT branch on internal states like `retry-wait`; use events instead.

**Ownership invariant:**

> A `Peer` owns zero or more `Session` instances over time.
> At most one `Session` may be `Active` per peer in v1.

The `Peer` type is not exposed as a public class in v1, but this invariant guides internal design and prevents multi-session ambiguity.

### 3. Session States

```
                    ┌─────────────┐
                    │    Idle     │◄────────────────────┐
                    └──────┬──────┘                     │
                           │ connect()                  │ terminate() / fatal
                           ▼                            │
                    ┌─────────────┐                     │
            ┌──────►│ Connecting  │─────────────────────┤
            │       └──────┬──────┘                     │
            │              │ transport open             │
            │              ▼                            │
            │       ┌─────────────┐                     │
            │       │ Negotiating │─────────────────────┤
            │       └──────┬──────┘                     │
            │              │ negotiation complete       │
            │              ▼                            │
            │       ┌─────────────┐                     │
  retry     │       │   Active    │─────────────────────┘
            │       └──────┬──────┘
            │              │ transport error (retryable)
            │              ▼
            │       ┌─────────────┐
            └───────┤  RetryWait  │
                    └─────────────┘
```

**State definitions:**

| State         | Meaning                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `Idle`        | No session. Initial and terminal state.                                  |
| `Connecting`  | Transport `connect()` in progress.                                       |
| `Negotiating` | Transport open, negotiator establishing channel (handshake, E2EE, auth). |
| `Active`      | Ready for message exchange.                                              |
| `RetryWait`   | Waiting before retry attempt (if retry enabled).                         |

### 4. Pluggable Negotiators

Negotiators handle protocol-specific session establishment:

```ts
interface Negotiator {
  /** Establish session after transport opens */
  negotiate(conn: TransportConnection): Promise<NegotiationResult>;

  /** Protocol-specific close; MUST be idempotent */
  terminate(conn: TransportConnection, reason?: string): Promise<void>;

  /** Classify an error as fatal or retryable */
  classifyError(error: Error): "fatal" | "retryable";
}

interface NegotiationResult {
  peerId: PeerId;
  identity?: VerifiedIdentity;
  capabilities: string[];
  metadata: Record<string, string>;
  channel?: SessionChannel; // Optional session-layer channel (see SessionChannel type)
}

// SessionChannel is a session-layer abstraction that implements TransportConnection.
// It MAY wrap an underlying transport with encryption or other session-specific processing.
type SessionChannel = TransportConnection;

// v2 extension for session resume (not in v1)
interface ResumableNegotiator extends Negotiator {
  resume(
    conn: TransportConnection,
    token: Uint8Array,
  ): Promise<NegotiationResult>;
}
```

**Built-in negotiators:**

| Negotiator      | Protocol | Behavior                                         |
| --------------- | -------- | ------------------------------------------------ |
| `SbpNegotiator` | SBP      | Handshake frame exchange, capability negotiation |

> **SBRP Integration**: The runtime does NOT include an `SbrpNegotiator`. SBRP is a session-layer E2EE protocol with complex cryptography; its primitives live in `@sideband/secure-relay`. SBRP can integrate via:
>
> 1. **Custom Negotiator with `channel`**: Implement a negotiator that performs SBRP key exchange and returns a `NegotiationResult.channel` — a wrapped `TransportConnection` that encrypts outbound frames and decrypts inbound frames. The runtime uses this channel transparently.
> 2. **Transport Adapter**: Embed SBRP logic in a custom transport that exposes decrypted SBP frames directly. Simpler but couples session and transport layers.
>
> See `docs/protocols/architecture.md` "Session Output Contract" for the normative interface.

**SBP negotiation sequence:**

```
Client                              Server
  │──────── Handshake{peerId} ─────────►│
  │◄─────── Handshake{peerId} ──────────│
  │            [Active]                 │
```

For SBRP negotiation sequences, see `docs/protocols/sbrp/` and `@sideband/secure-relay`.

### 5. Error Classification

The **negotiator** classifies errors as fatal or retryable via `classifyError()`. The runtime never hardcodes fatality—this keeps security-sensitive decisions in the negotiator where they belong.

**Typical classifications (examples, not rules):**

| Error type                     | Typical classification | Notes                                   |
| ------------------------------ | ---------------------- | --------------------------------------- |
| Transport connect failure      | Retryable              | Network transient                       |
| Negotiation timeout            | Negotiator decides     | Could be transient or MITM interference |
| Protocol violation (bad frame) | Fatal                  | Per SBP spec                            |
| Identity mismatch (TOFU)       | Fatal                  | Security-critical                       |
| Unsupported protocol version   | Fatal                  | Per SBP spec                            |
| Application error              | Retryable              | Non-fatal to transport                  |

**Invariants:**

- Negotiators MUST classify `ProtocolViolation` and `UnsupportedVersion` as fatal per SBP spec
- `"fatal"` means "terminate this session and do not retry"—it does **not** necessarily imply a protocol violation (e.g., identity mismatch is fatal but not a protocol error)
- Other classifications are negotiator-specific

### 6. Retry Policy

Retry is **per-session** and **opt-in**:

```ts
interface RetryPolicy {
  mode: "never" | "on-error"; // Default: "never"
  backoff: BackoffPolicy;
}

interface BackoffPolicy {
  initialDelayMs: number; // Default: 1000
  maxDelayMs: number; // Default: 30000
  maxAttempts: number; // Retry attempts (excludes initial); 0 = unlimited
  jitter: number; // Default: 0.2 (20%)
}
```

**Backoff formula:**

```
delay = min(initial * 2^attempt, max) * (1 + random(-jitter, +jitter))
```

**Retry behavior:**

1. Transport error in `Active` → transition to `RetryWait`
2. Wait backoff delay
3. Transition to `Connecting`, attempt new connection
4. On success: full re-negotiation (no session resume in v1)
5. On max attempts: transition to `Idle`, emit `closed` event

**Attempt counting:** `maxAttempts` counts only retry attempts, not the initial connection. With `maxAttempts: 5`, a total of 6 connection attempts occur (1 initial + 5 retries). The attempt counter resets on successful transition to `Active`.

**Retry invariants:**

- When retrying, a new Session replaces the previous Session for the same Peer; retries never create parallel sessions
- Calling `terminate()` cancels any pending retries and transitions immediately to `Idle`

**Channel and retry semantics:**

If a negotiator returns a wrapped `channel`, channel-level errors (e.g., decryption failure, session expiry) are surfaced to the runtime as session errors and classified via `Negotiator.classifyError()`. Retries always:

1. Close the existing channel and transport
2. Re-establish a fresh transport connection
3. Re-invoke `negotiate()` to obtain a new channel

The runtime does not attempt to "resume" a wrapped channel; each retry creates an entirely new session.

### 7. Session Events

```ts
interface SessionEvents {
  connecting: { endpoint: string };
  negotiating: { transport: TransportConnection };
  active: { peerId: PeerId; capabilities: string[] };
  retrying: { attempt: number; delayMs: number; lastError: Error };
  closed: { reason: string; wasClean: boolean; fatal: boolean };

  // Security events (from negotiator)
  identity_established: { identity: VerifiedIdentity; trusted: boolean };
  identity_mismatch: { expected: VerifiedIdentity; received: VerifiedIdentity };
}
```

The `active` event carries negotiation results, not the session itself — subscribers already hold the session reference. This keeps events serializable and avoids circular references.

Note: `identity_established` (not `identity_verified`) because TOFU is trust establishment, not cryptographic verification. The `trusted` flag indicates whether this identity was previously pinned.

### 8. Protocol-Aware Termination

Termination follows a strict ordering to ensure proper cleanup:

```ts
async function terminate(reason?: string): Promise<void> {
  // 1. Protocol-level signaling via negotiator (uses raw transport)
  await negotiator.terminate(transport, reason);

  // 2. Close session channel (if distinct from transport)
  if (channel !== transport) {
    await channel.close(reason);
  }

  // 3. Close underlying transport
  await transport.close(reason);

  // 4. Transition to Idle
  state = "idle";
}
```

**Close ordering invariant:**

> When a session provides a `SessionChannel` distinct from the underlying transport, the runtime MUST close the channel before closing the transport.

This ensures session-layer cleanup (e.g., encryption state, pending operations) completes while the transport is still available.

**Negotiator.terminate() scope:**

`Negotiator.terminate()` is responsible only for **protocol-level signaling** over the underlying transport (e.g., sending SBP Close frames). Session-layer resource cleanup MUST be handled by closing the `SessionChannel`. The negotiator receives the raw transport, not the wrapped channel.

**Idempotency invariants:**

- `terminate()` MUST be idempotent (safe to call multiple times)
- Negotiators MUST tolerate already-closed transports
- Close errors are logged but do not throw

**SbpNegotiator.terminate():**

```ts
// Send Close control frame if transport is open
if (conn.state === "open") {
  await send(
    createControlFrame({ op: ControlOp.Close, data: encodeReason(reason) }),
  );
}
```

For SBRP termination semantics, see `docs/protocols/sbrp/state-machine.md`.

### 9. Session Resumption Semantics

Runtime core does not require resumable sessions. Terminology:

| Term                    | Meaning                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| **Transport reconnect** | WebSocket drops and reconnects (pure transport layer)                   |
| **Session resume**      | Reuse same cryptographic state without new handshake (SBRP daemon only) |
| **Client reconnect**    | Always requires new token + full handshake                              |

**v1 behavior:**

- Client reconnects always create fresh sessions
- SBRP daemons MAY implement resumable sessions (gated by `Signal(ready)` state machine)
- Non-SBRP negotiators may ignore resume entirely
- Pending RPC requests are rejected on disconnect; application handles retransmission

SBRP implementations (whether via custom negotiator or transport adapter) MUST implement the SBRP pause/pending/resume state machine when supporting resumable daemon sessions. See `docs/protocols/sbrp/state-machine.md`. Session resume can be extended to clients in v2 via `ResumableNegotiator` interface.

## Alternatives Considered

| Alternative                              | Why Rejected                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Single handshake model for all protocols | SBRP and SBP have fundamentally different handshakes                   |
| Global retry policy                      | Different transports have different reliability characteristics        |
| peerId as security identity              | Conflates routing with authentication; SBRP TOFU pins keys, not peerId |
| Session resume in v1                     | Adds complexity; v1 focuses on correctness                             |

## Consequences

- **Protocol isolation**: SBP and SBRP don't leak into each other
- **Future-proof**: SBDP or new protocols slot in as new negotiators
- **Clear security model**: `identity` is distinct from `peerId`
- **Testable**: Each layer can be tested independently
- **No hidden magic**: Retry is opt-in, termination is explicit

## References

- ADR-005 (Transport ABI)
- `docs/protocols/sbp/behavior.md` (handshake-first rule)
- `docs/protocols/sbrp/` (E2EE handshake, TOFU)
- `packages/secure-relay/src/handshake.ts` (SBRP implementation)
