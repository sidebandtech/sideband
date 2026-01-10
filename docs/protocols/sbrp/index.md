# Sideband Relay Protocol (SBRP)

**Version:** 0.1.0
**Status:** Draft
**Last Updated:** 2025-01-09

## Documents

| Document                            | Status     |
| ----------------------------------- | ---------- |
| This document                       | Normative  |
| [State Machine](./state-machine.md) | Supporting |
| [Compliance](./compliance.md)       | Supporting |

## Related ADRs

- ADR-002: Naming matrix (SBRP abbreviation)

## 1. Overview

SBRP enables secure communication between local daemons (background services, agents, or processes) and browser-based UIs via a relay server. The protocol uses a hybrid trust model:

- **Relay is trusted** for token validation, access enforcement, and routing
- **Relay cannot decrypt** application payloads (end-to-end encrypted)
- **Relay cannot perform undetectable MITM on established TOFU pins** (key substitution is detected)

This provides persistent multi-device access while ensuring message confidentiality.

::: warning TOFU Limitation
As with SSH-style TOFU systems, the first connection trusts the control plane to provide the correct daemon identity key. Subsequent connections are cryptographically protected against key substitution.
:::

### 1.1 Architecture

```text
┌─────────┐         ┌─────────┐         ┌─────────┐
│ Browser │◄──TLS──►│  Relay  │◄──TLS──►│ Daemon  │
│         │  auth   │ Server  │  auth   │         │
└─────────┘         └─────────┘         └─────────┘
     │                   │                   │
     │      [auth, routing, presence]        │
     │                   │                   │
     └────────── E2EE encrypted ─────────────┘
           [signed handshake, encrypted payloads]
```

### 1.2 Design Goals

- Persistent access from any device
- Multi-device support (mobile, desktop, multiple browsers)
- End-to-end encryption for application data
- Cryptographic MITM protection (not just trust-based)
- Standard OAuth/session authentication
- Zero local TLS/certificate configuration

### 1.3 Non-Goals

- Protecting against compromised relay (auth/routing layer)
- Transport-level anonymity
- Hiding metadata (timing, message size, which daemon you're connecting to)

## 2. Terminology

**Client**: Session initiator authenticated via control plane. Generates ephemeral X25519 keys per session. No persistent _cryptographic_ identity (no long-lived signing key; authentication identity like user ID is managed by control plane). Verifies daemon via TOFU. May be a browser, CLI, native app, or any non-daemon participant.

**Daemon**: Long-lived agent with Ed25519 identity keypair. Registers with control plane via API key; connects to relay using presence tokens. Reachable only through relay.

**Relay**: Routing authority and token validator. Not an encryption endpoint. Does not authenticate directly; validates tokens issued by control plane.

## 3. Trust Model

### 3.1 What Relay Can Do

- Validate tokens issued by control plane (users and daemons)
- Route connections between them
- See metadata (timing, size, frequency)
- Drop or delay messages (DoS)
- Route session establishment when a client presents a valid session token (relay does not autonomously initiate sessions; it acts on control-plane-issued tokens)

### 3.2 What Relay Cannot Do

- Decrypt message content (E2EE)
- Perform undetectable MITM after initial TOFU trust establishment (daemon signs ephemeral keys, client pins identity)
- Forge daemon identity (Ed25519 signatures)

::: info Authentication Scope
SBRP authenticates the daemon to the client, but does not cryptographically authenticate the client to the daemon. This is an accepted trade-off to enable standard web authentication models without client key management.
:::

::: warning Daemon Trust Boundary
From the daemon's perspective, all relay-authenticated clients are equivalent. The relay can initiate sessions on behalf of any authenticated user. Daemon implementations MUST treat all client input as untrusted and implement application-level authorization within encrypted messages if needed (e.g., signed user claims, application tokens).
:::

### 3.3 Identity Key Trust (TOFU)

The client **MUST** persist daemon identity public keys locally using Trust On First Use:

1. **First connection:** Client verifies signature using control-plane-provided key; on successful handshake, stores `identityPublicKey` locally
2. **Subsequent connections:** Client compares control-plane-provided key against stored key before handshake
3. **Key mismatch:** Abort with `identity_key_changed` error, require user approval to accept new key

```typescript
// Client storage (IndexedDB recommended over localStorage for browsers)
interface PinnedIdentity {
  daemonId: string;
  identityPublicKey: string; // base64 Ed25519 public key
  firstSeen: string; // ISO timestamp
  lastSeen: string; // ISO timestamp
}
```

**Persistence requirements:**

- Implementations MUST persist pins across page reloads (for browser clients)
- Implementations SHOULD survive application restarts (durable storage such as IndexedDB, localStorage, or platform key store)
- If storage is unavailable or cleared, treat as first-time connection and SHOULD warn user
- Incognito/private mode reduces security guarantees (no persistence across sessions); implementations MAY warn in ephemeral contexts (browser clients)

**Multi-device behavior:**

- Identity pinning is per client/device storage
- Different clients independently establish trust with the same daemon
- Pins are NOT synced via relay (doing so would defeat TOFU security)
- Not syncing pins is intentional: syncing via relay would reintroduce a trusted key distribution authority

**Key rotation:**

- Daemon identity keys are long-lived; rotation is a manual, user-approved operation
- The protocol does not support silent key rotation
- Control plane MUST return exactly one identity key per daemon (the active key)
- Daemon MUST sign with the key currently registered as active at the control plane
- Rotation flow (when needed, e.g., key compromise):
  1. Daemon generates new Ed25519 keypair
  2. Daemon registers new public key with control plane, atomically replacing the old key
  3. Daemon starts signing handshakes with the new key
  4. Clients connecting see `identity_key_changed` error (pinned key differs from control-plane-provided key)
  5. Client MUST present both fingerprints and require explicit user approval
  6. Upon approval, client updates pinned key and proceeds with handshake

::: danger Key Mismatch = Possible MITM
On mismatch, client MUST abort and present clear warning before allowing user to accept new key.
:::

**Security properties:**

- First connection: Trusts control-plane-provided key (inherent TOFU limitation)
- Subsequent connections: Key substitution detected via pinned key comparison

::: tip First-Connection Mitigation
For security-sensitive deployments, implementations SHOULD encourage out-of-band fingerprint verification on first connection. Display a clear "first connection" indicator and provide easy access to the daemon's fingerprint for manual verification via a second channel (CLI output, documentation, QR code).
:::

::: details Optional: Out-of-band fingerprint verification
Daemon CLI can display identity fingerprint for manual verification:

```text
$ myapp daemon status
Daemon ID:    d_abc123
Fingerprint:  SHA256:AB:CD:EF:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A
```

Format: `SHA256:` + hex-encoded SHA-256 hash of identity public key (colon-separated). Implementations MAY also display base64url for QR/URL workflows.
:::

### 3.4 Trust Boundaries

| Component       | Trust Level        | Compromise Impact                              |
| --------------- | ------------------ | ---------------------------------------------- |
| Relay auth      | Trusted            | Can deny service, can't decrypt                |
| Relay transport | Honest-but-curious | Sees encrypted blobs only                      |
| Client runtime  | Trusted            | Full compromise (inherent to web for browsers) |
| Daemon          | Trusted            | Full compromise                                |

## 4. Cryptographic Primitives

| Purpose              | Primitive         | Notes                    |
| -------------------- | ----------------- | ------------------------ |
| Identity signing     | Ed25519           | Long-lived daemon key    |
| Key exchange         | X25519            | Ephemeral per session    |
| Symmetric encryption | ChaCha20-Poly1305 | All message payloads     |
| Key derivation       | HKDF-SHA256       | Session key derivation   |
| Hashing              | SHA-256           | Signature payloads, salt |

::: tip Why Ed25519 for identity?
X25519 is for key exchange only. Without signatures, the relay could substitute keys during handshake and perform MITM. Ed25519 signatures ensure the client can cryptographically verify it's talking to the real daemon, not a relay-in-the-middle.
:::

## 5. Actors and Authentication

SBRP uses two-tier authentication: the **control plane** handles user/daemon registration and session brokering; the **data plane** (relay) validates tokens for WebSocket connections. Two token types exist: short-lived **session tokens** for clients and long-lived **presence tokens** for daemons. See Appendix C for relay token details.

### 5.1 User

- Authenticates to control plane via OAuth, passkeys, or session-based auth
- Obtains relay tokens from control plane for WebSocket connections
- Can register multiple daemons
- Can connect from multiple devices

### 5.2 Daemon

- Registers with control plane via API key (issued per daemon)
- Has Ed25519 identity keypair (signs handshakes)
- Identity public key is registered with control plane; clients fetch it from there
- Connects to relay with presence token (see Appendix C.7)

### 5.3 Client

- Authenticates to control plane via user session
- Obtains relay token from control plane, connects to relay
- Generates ephemeral X25519 keys per connection
- Verifies daemon signatures using locally pinned identity key (TOFU)
- Can connect to any daemon the user owns

## 6. Protocol Flow

### 6.1 Daemon Registration (One-Time)

Daemon generates identity keypair on first run and registers with control plane.

```text
Daemon                           Control Plane                    Relay
   │                                  │                              │
   │── POST /api/daemons/register ───►│                              │
   │   {                              │                              │
   │     "apiKey": "dk_xxx",          │                              │
   │     "name": "macbook-pro",       │                              │
   │     "identityPublicKey": "..."   │  ← Ed25519 public key        │
   │   }                              │                              │
   │◄─── 200 OK ──────────────────────│                              │
   │   {                              │                              │
   │     "daemonId": "d_abc123",      │                              │
   │     "relayUrl": "wss://...",     │                              │
   │     "presenceToken": "<jwt>"     │  ← Long-lived presence token │
   │   }                              │                              │
   │                                  │                              │
   │── WSS /relay?token=<jwt> ────────┼─────────────────────────────►│
   │                                  │                              │
```

**Daemon key storage:** Application-specific path (e.g., `~/.config/<app>/identity.json`)

```json
{
  "daemonId": "d_abc123",
  "identityPublicKey": "<base64-ed25519-public>",
  "identityPrivateKey": "<base64-ed25519-private>"
}
```

File permissions: `0600` (owner read/write only).

### 6.2 Client Connection

Client lists available daemons via control plane, obtains relay token, and connects.

```text
Client                           Control Plane                    Relay
   │                                  │                              │
   │── GET /api/daemons ─────────────►│                              │
   │   Cookie: session=xxx            │                              │
   │                                  │                              │
   │◄─── 200 OK ──────────────────────│                              │
   │   [{                             │                              │
   │     "id": "d_abc123",            │                              │
   │     "name": "macbook-pro",       │                              │
   │     "status": "online",          │                              │
   │     "identityPublicKey": "..."   │  ← Ed25519 public key        │
   │   }]                             │                              │
   │                                  │                              │
   │── POST /api/sessions ───────────►│                              │
   │   { "daemonId": "d_abc123" }     │                              │
   │                                  │                              │
   │◄─── 200 OK ──────────────────────│                              │
   │   {                              │                              │
   │     "relayUrl": "wss://...",     │                              │
   │     "token": "<jwt>"             │  ← Short-lived session token │
   │   }                              │                              │
   │                                  │                              │
   │── WSS /relay?token=<jwt> ────────┼─────────────────────────────►│
   │                                  │                              │
```

**Session ID:** The session token (JWT) contains a `sid` claim with the SessionID as a base64url-encoded 8-byte big-endian uint64. Decode this value and use it in the `SessionID` field of all session-bound frames (see §13.1 for wire format, §C.6 for token binding details).

Client caches `identityPublicKey` for signature verification (TOFU).

### 6.3 E2EE Handshake

After WebSocket connection, client and daemon perform authenticated key exchange using binary frames (see §13 for wire format).

```text
Client                     Relay                    Daemon
   │                         │                         │
   │                    [WebSocket connected]          │
   │                         │                         │
   │── HandshakeInit (0x01) ►│── forward ─────────────►│
   │   [32B X25519 key]      │                         │  ← clientEphemeralPublicKey
   │                         │                         │
   │                         │                         │  Daemon:
   │                         │                         │  1. Generate X25519 ephemeral
   │                         │                         │  2. Sign ephemeral with Ed25519
   │                         │                         │
   │◄───────────────────────────── HandshakeAccept (0x02)
   │                         │   [32B X25519 key]      │  ← daemonEphemeralPublicKey
   │                         │   [64B signature]       │  ← Ed25519 signature
   │                         │                         │
   │  Client:                │                         │
   │  1. Verify signature    │                         │
   │  2. Derive shared secret│                         │
   │                         │                         │
   │◄══════════ Encrypted frames (0x03) ══════════════►│
   │   (relay sees opaque binary only)                 │
```

Future versions MAY support client-held identity keys for cryptographic user authentication; SBRP v1 does not require this.

### 6.4 Signature Verification

Daemon signs its ephemeral public key with context binding:

```text
signaturePayload = SHA256(
  "sbrp-v1-handshake" ||
  daemonId ||
  clientEphemeralPublicKey ||
  daemonEphemeralPublicKey
)

signature = Ed25519.sign(identityPrivateKey, signaturePayload)
```

**String encoding:** Context strings (`"sbrp-v1-handshake"`, `"sbrp-v1-transcript"`) and `daemonId` MUST be UTF-8 encoded with no BOM or length prefix before concatenation.

Client verifies using **pinned** identity key (see §3.3):

```text
valid = Ed25519.verify(pinnedIdentityPublicKey, signaturePayload, signature)
```

If verification fails → abort handshake immediately.

**Handshake timeout:** Handshake SHOULD complete within 30 seconds. Client measures from WebSocket open; daemon measures from receiving `HandshakeInit`. Implementations MUST abort with `handshake_failed` if the timeout expires.

**Why this prevents MITM:**

1. Client uses locally-pinned identity key (TOFU), not freshly-fetched key
2. Relay doesn't have the daemon's Ed25519 private key
3. Signature binds to specific daemonId, preventing cross-daemon confusion
4. Signature binds to specific clientEphemeralPublicKey, preventing replay

**Design note:** The relay origin is not included in the signature payload because daemonId is globally unique within the control plane's namespace. Token claims (`did`, optional `region`) bind sessions to specific daemons and relays. Cross-region replay is prevented by the `region` claim validation at token verification time, not at the cryptographic layer.

### 6.5 Key Derivation

Both parties compute:

```text
sharedSecret = X25519(myEphemeralPrivate, peerEphemeralPublic)

// Transcript hash binds session keys to the authenticated handshake
transcriptHash = SHA256(
  "sbrp-v1-transcript" ||
  daemonId ||
  clientEphemeralPublicKey ||
  daemonEphemeralPublicKey ||
  signature
)

sessionKeys = HKDF-SHA256(
  ikm:  sharedSecret,
  salt: transcriptHash,
  info: "sbrp-session-keys",
  len:  64
)

clientToDaemon = sessionKeys[0:32]
daemonToClient = sessionKeys[32:64]
```

**Design rationale:**

- HKDF info parameter MUST be the protocol-defined constant "sbrp-session-keys"
- Transcript hash as salt binds keys to this specific authenticated session
- Including signature ensures derived keys are tied to verified identity
- Directional keys prevent reflection attacks
- Transcript context string provides domain separation

### 6.6 Encrypted Messages

All application messages after handshake use binary `Encrypted` frames (type `0x03`, see §13). The encrypted payload structure:

```text
nonce (12 bytes) || ciphertext || authTag (16 bytes)
```

**Nonce construction:**

- Bytes 0-3: Direction (`0x00000001` = client→daemon, `0x00000002` = daemon→client)
- Bytes 4-11: Sequence number (big-endian uint64)

**Additional Authenticated Data (AAD):**

- AAD MUST be empty (zero-length byte array)
- Context binding is achieved via nonce (direction + sequence) and key derivation (transcript hash includes handshake data)
- Implementations MUST NOT use non-empty AAD

**Sequence numbers:**

- Start at 0, increment per message per direction
- Sequence number space is 64-bit; replay window is an implementation-defined sliding subset
- Receiver MUST use bitmap-based sliding window of at least 64 messages
- Receiver SHOULD use window size at least 128
- Receiver MAY use 256 or larger for high-latency or bursty traffic
- Messages outside window are rejected
- Bitmap approach prevents memory exhaustion from attacker-controlled sequence numbers
- Large sequence jumps (beyond window size) MUST be handled in O(1) by resetting the bitmap rather than iterating; failure to do so enables CPU exhaustion attacks

```typescript
// Bitmap-based sliding window (prevents memory DoS)
// NOTE: This example shows the algorithm with a minimal 64-message window.
// Production implementations SHOULD use ≥128 (e.g., two 64-bit words or Uint8Array).
interface ReplayWindow {
  maxSeen: bigint; // highest accepted sequence
  bitmap: bigint; // bit i set = (maxSeen - i) was seen
}

function checkReplay(seq: bigint, window: ReplayWindow): boolean {
  if (seq > window.maxSeen) {
    // New high sequence - shift window
    const shift = seq - window.maxSeen;
    window.bitmap = shift >= 64n ? 0n : window.bitmap << shift;
    window.bitmap |= 1n; // mark current as seen
    window.maxSeen = seq;
    return true;
  }
  const diff = window.maxSeen - seq;
  if (diff >= 64n) return false; // too old
  const mask = 1n << diff;
  if (window.bitmap & mask) return false; // replay
  window.bitmap |= mask;
  return true;
}
```

## 7. Message Categories

This section describes semantic message categories. See §13 for binary wire encoding.

SBRP uses three message classes with clear authority boundaries:

1. **Endpoint frames** (forwarded, E2EE): `HandshakeInit`, `HandshakeAccept`, `Data`
2. **Signal frames** (daemon → relay): `Signal` with ready/close codes
3. **Control frames** (relay → endpoint): Unified errors and state notifications

### 7.1 Endpoint Frames (Forwarded)

These frames participate in E2EE and are forwarded by the relay without inspection.

| Type            | Hex    | Direction       | Purpose                         |
| --------------- | ------ | --------------- | ------------------------------- |
| HandshakeInit   | `0x01` | Client → Daemon | Client's ephemeral X25519 key   |
| HandshakeAccept | `0x02` | Daemon → Client | Daemon's signed ephemeral key   |
| Data            | `0x03` | Either          | E2EE encrypted application data |

### 7.2 Signal Frames (Daemon → Relay)

Session lifecycle commands from daemon to relay. Never forwarded.

| Type   | Hex    | Direction      | Purpose                   |
| ------ | ------ | -------------- | ------------------------- |
| Signal | `0x04` | Daemon → Relay | Session lifecycle command |

Signal codes:

- `0x00` ready: Session state retained, ready to resume
- `0x01` close: Session terminated

### 7.3 Control Frames (Relay → Endpoint)

Unified relay-to-endpoint notifications. Replaces separate Error and SessionNotify frames.

| Type    | Hex    | Direction    | Purpose                        |
| ------- | ------ | ------------ | ------------------------------ |
| Control | `0x20` | Relay → Peer | Errors and state notifications |

Control codes use ranges to categorize error types; terminality is defined per code (see §14).

### 7.4 Keepalive Frames (Connection-Scoped)

Connection liveness detection. Handled locally, never forwarded.

| Type | Hex    | Direction | Purpose            |
| ---- | ------ | --------- | ------------------ |
| Ping | `0x10` | Either    | Keepalive request  |
| Pong | `0x11` | Either    | Keepalive response |

::: info Why Protocol-Level Ping/Pong?
Browser clients cannot send WebSocket ping frames (RFC 6455 restriction). Protocol-level Ping enables browser-to-relay keepalive and works before E2EE sessions are established.
:::

## 8. Relay Server Responsibilities

### 8.1 Token Validation

- Validate relay tokens issued by the control plane (see Appendix C)
- Enforce token claims: role, daemonId, sessionId, expiration
- Enforce user → daemon ownership via token claims

### 8.2 Key Distribution

- Relay does NOT distribute or receive daemon identity keys; clients obtain keys from control plane
- Relay has no access to private or public identity keys and does not verify signatures

### 8.3 Routing

- Maintain WebSocket connections for daemons and clients
- Route messages between paired connections
- Handle multiple clients per daemon

### 8.4 Presence

- Track daemon online/offline status
- Send `Control(session_paused)` to clients when daemon disconnects
- On daemon reconnect within grace window:
  - **Non-resumable daemons** (`res: false`): immediately send `Control(session_expired)` to all paired clients
  - **Resumable daemons** (default): send `Control(session_pending)` to client, wait for daemon to send `Signal(ready)` or `Signal(close)` per session
- On `Signal(ready)` from daemon: send `Control(session_resumed)` to client, resume routing
- On `Signal(close)` from daemon: send `Control(session_expired)` to client, close session pairing
- Send `Control(session_expired)` and close client WebSocket if grace window expires (daemon didn't reconnect, or reconnected but didn't signal within grace period)
- Send `Control(session_ended)` to daemon when client disconnects, if daemon is connected (enables per-session cleanup); if daemon is offline, silently tear down pairing

### 8.5 Keepalive Handling

- Ping/Pong frames are **connection-scoped** (SessionID MUST be 0)
- Ping/Pong frames are **never forwarded**
- Relay MUST respond to incoming Ping with Pong, copying payload
- Relay MAY send Ping to endpoints to detect dead connections
- Ping payload is optional (0-8 bytes), used for RTT measurement

### 8.6 Rate Limiting

- Max 100 messages/second per connection
- Max 64 KB per message (frame payload, excluding 13-byte header)
- Max 10 daemons per user (configurable)
- Max 5 concurrent client connections per daemon

## 9. Quick Connect (Optional)

For scenarios without account (local dev, demos), support ephemeral connect codes via control plane:

```text
Daemon                           Control Plane                    Relay
   │                                  │                              │
   │── POST /api/connect/code ───────►│                              │
   │   Authorization: Bearer dk_xxx   │                              │
   │                                  │                              │
   │◄─── 200 OK ──────────────────────│                              │
   │   {                              │                              │
   │     "code": "A7F3-KQP9",         │                              │
   │     "expiresAt": "...",          │                              │
   │     "url": "https://app.example  │                              │
   │            /connect/A7F3-KQP9"   │                              │
   │   }                              │                              │
   │                                  │                              │
```

Client navigating to URL gets temporary access without login. Code expires in 5 minutes. E2EE handshake (with signature verification) proceeds normally.

**Security requirements** (control plane responsibility):

- Quick Connect MUST NOT be enabled by default; require explicit operator opt-in
- Control plane MUST enforce code expiry server-side; stale codes MUST be rejected
- Control plane MUST rate-limit code generation (e.g., max 10 per minute per daemon)
- Codes MUST use high-entropy random values (≥128 bits)
- Control plane MUST enforce TTL eviction and SHOULD enforce one-time use; MAY use durable storage with TTL for HA deployments

::: danger Reduced Security
Quick Connect bypasses standard user authentication. MUST be disabled by default in production deployments. Enable only for local development, demos, or with explicit operator opt-in and audit logging.
:::

## 10. Security Properties

### 10.1 Guarantees

| Property                | Mechanism                    |
| ----------------------- | ---------------------------- |
| Message confidentiality | ChaCha20-Poly1305 E2EE       |
| Message integrity       | Poly1305 auth tag            |
| Daemon authenticity     | Ed25519 identity signatures  |
| Forward secrecy         | Ephemeral X25519 per session |
| Replay protection       | Sequence numbers in nonce    |

### 10.2 Attack Resistance

| Attack               | Mitigation                                                                    |
| -------------------- | ----------------------------------------------------------------------------- |
| Relay reads messages | E2EE encryption                                                               |
| Relay MITM           | Ed25519 signatures on ephemeral keys                                          |
| Replay attack        | Sequence numbers, sliding window                                              |
| Reflection attack    | Directional keys                                                              |
| Key substitution     | Signature binds ephemeral to identity                                         |
| Session hijacking    | Token-based auth; relay acts on tokens, cannot verify user intent (see §10.3) |

### 10.3 Limitations

| Attack                         | Status                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Compromised relay auth         | Can deny service, can't decrypt or MITM                                                                          |
| Compromised client runtime     | Full compromise (inherent to web apps for browsers)                                                              |
| Traffic analysis               | Relay sees timing, size, frequency; may infer high-level usage patterns                                          |
| Daemon identity key compromise | Must rotate key, re-register                                                                                     |
| Relay user impersonation       | Relay cannot verify user actually requested the session; client is not cryptographically authenticated to daemon |

### 10.4 Optional Privacy Enhancements (Non-Normative)

Implementations MAY pad encrypted payloads or batch messages to reduce traffic analysis, depending on application needs.

## 11. Reconnection

### 11.1 Daemon Reconnection

If daemon WebSocket disconnects:

1. Daemon reconnects with valid presence token (refresh from control plane if expired)
2. **Non-resumable daemons** (`res: false` in token): Relay automatically sends `Control(session_expired)` to all paired clients; no further daemon action required. See §C.7.
3. **Resumable daemons** (default): Relay restores daemon's connection state; clients remain in pending state. Daemon MUST check retained state for each session and explicitly signal readiness:
4. **If state is retained** (within 30s grace period AND daemon retains **ALL** of):
   - Session keys (`clientToDaemon`, `daemonToClient`)
   - Send sequence counters (both directions)
   - Replay window state (bitmap + maxSeen, both directions)
   - → Daemon sends `Signal(ready)` for the session
   - → Relay sends `Control(session_resumed)` to client
   - → Resume normally; sequence numbers MUST continue monotonically per direction
5. **If state is lost** (process restart, memory loss, or ANY state component missing):
   - Daemon MUST send `Signal(close, reason=state_lost)` for each affected session
   - Relay sends `Control(session_expired)` to client and closes session pairing
   - Client initiates full reconnect with new handshake (existing behavior)

::: tip Simple Daemons
For v1 implementations that don't need session resumption, request a presence token with `res: false`. The relay handles session cleanup automatically on reconnect—no need to track session IDs or send Signal frames.
:::

::: warning State Loss = Signal(close) Required
For resumable daemons: partial state loss (e.g., replay window cleared but keys retained) is catastrophic. Implementations MUST send `Signal(close)` for any session with incomplete state. Attempting to resume with partial state will cause decrypt failures.
:::

### 11.2 Client Reconnection

If client WebSocket disconnects:

1. Client obtains a new session token from control plane (new `sid`)
2. Client connects to relay with the new token
3. Full E2EE handshake required (new ephemeral keys)
4. Application should handle state resync

::: info No Client Session Resumption
Unlike daemons, clients do not support session resumption. Each client reconnection is a fresh start: new session token, new ephemeral keys, new sequence counters. Session tokens are short-lived (≤300s) by design.
:::

## 12. Multi-Device Support

### 12.1 Multiple Clients

- Each client has independent E2EE session with daemon
- Daemon maintains separate key state per client
- Messages are not broadcast (each client gets its own responses)

### 12.2 Implementation

```typescript
// Per-direction crypto state (traffic key, counters, replay window)
interface ChannelState {
  trafficKey: Uint8Array; // 32 bytes
  sendSeq: bigint;
  recvWindow: ReplayWindow; // bitmap-based (see §6.6)
}

// Daemon session state per client connection
interface ClientSession {
  clientToDaemon: ChannelState;
  daemonToClient: ChannelState;
}

// Sessions keyed by SessionID from frame header (see §13.1, §C.7)
const sessions = new Map<bigint, ClientSession>();
```

## 13. Wire Format (Binary Framing)

All relay communication uses binary frames over WebSocket (binary message type). The relay inspects ONLY the frame header for routing decisions; payload content is opaque bytes that the relay MUST NOT interpret.

### 13.1 Frame Structure

```text
┌───────────┬──────────────┬────────────────┬─────────────────────┐
│ Type (1B) │ Length (4B)  │ SessionID (8B) │ Payload (0..64KB)   │
└───────────┴──────────────┴────────────────┴─────────────────────┘
     │            │               │                  │
     │            │               │                  └─ Opaque bytes (handshake or encrypted)
     │            │               └─ Session ID (big-endian uint64)
     │            └─ Payload length in bytes (big-endian uint32, excludes header)
     └─ Frame type (see §13.2)
```

- **Header size:** 13 bytes (fixed)
- **Max payload:** 65536 bytes (64 KB, per §8.5)
- **Byte order:** Big-endian for all multi-byte integers

### 13.2 Frame Types

| Type            | Hex    | Direction       | SessionID | Description                            |
| --------------- | ------ | --------------- | --------- | -------------------------------------- |
| HandshakeInit   | `0x01` | Client → Daemon | Required  | Client's ephemeral X25519 key          |
| HandshakeAccept | `0x02` | Daemon → Client | Required  | Daemon's signed ephemeral key          |
| Data            | `0x03` | Either          | Required  | E2EE application payload               |
| Signal          | `0x04` | Daemon → Relay  | Required  | Session lifecycle command              |
| Ping            | `0x10` | Either          | Zero      | Keepalive request (connection-scoped)  |
| Pong            | `0x11` | Either          | Zero      | Keepalive response (connection-scoped) |
| Control         | `0x20` | Relay → Peer    | Varies    | Errors and state notifications         |

**Reserved frame type ranges:**

| Range       | Purpose                        | Status              |
| ----------- | ------------------------------ | ------------------- |
| `0x00`      | Invalid (undefined)            | Reserved            |
| `0x01–0x0F` | Session-bound endpoint frames  | 0x01–0x04 allocated |
| `0x10–0x1F` | Connection-scoped frames       | 0x10–0x11 allocated |
| `0x20–0x2F` | Relay-generated frames         | 0x20 allocated      |
| `0x30–0x7F` | Future protocol extensions     | Reserved            |
| `0x80–0xFF` | Experimental/vendor extensions | Reserved            |

**SessionID requirements:**

- Session-bound frames (`0x01`, `0x02`, `0x03`, `0x04`) MUST have non-zero SessionID
- Keepalive frames (`0x10`, `0x11`) MUST have SessionID = 0 (connection-scoped, never forwarded)
- Control frames (`0x20`) use non-zero SessionID for session events, zero for connection errors

**SessionID scope by Control code:** See §14.1 for the authoritative per-code SID column. Connection-level errors (SID=0) have no valid session context; session-specific events (SID=S) use the relevant non-zero SessionID.

**Authority boundaries:**

- Clients MUST NOT send Signal (`0x04`) or Control (`0x20`) frames
- Endpoints MUST NOT send Control (`0x20`) frames
- Relay MUST reject disallowed frames with `Control(disallowed_sender)` if header is parseable; if header is malformed or truncated, close WebSocket immediately with `Control(malformed_frame, SessionID=0)`

### 13.3 Relay Behavior

The relay MUST:

- Parse frame header (13 bytes) to extract type, length, and session ID
- Route endpoint frames (`0x01`, `0x02`, `0x03`) by session ID to the paired connection
- Handle `Signal` (`0x04`) from daemon:
  - `Signal(ready)`: send `Control(session_resumed)` to client, resume routing
  - `Signal(close)`: send `Control(session_expired)` to client, close session pairing
- Handle `Ping` (`0x10`) locally: respond with `Pong` copying payload; NEVER forward
- Handle `Pong` (`0x11`) locally: update liveness state; NEVER forward
- Reject `Control` (`0x20`) received from peers as `disallowed_sender`
- Reject `Signal` (`0x04`) received from clients as `disallowed_sender`
- Generate `Control` frames as needed (see §8.4, §14)
- Forward payload bytes of routed frames without modification
- Reject frames exceeding max payload size with `Control(payload_too_large)`

The relay MUST NOT:

- Interpret payload contents of endpoint frames
- Parse any structure within encrypted payloads
- Buffer, reassemble, or coalesce frames beyond transport requirements
- Modify frame bytes in transit
- Generate Control messages that leak information derived from encrypted payloads
- Include identifiers (daemonId, clientId, sessionId, tokens) in Control message text

::: warning Relay is a Frame Router
The relay operates on opaque binary frames. It has no knowledge of handshake semantics, encryption, or application protocols. This separation is intentional and MUST be preserved.
:::

**Frame validation order:** When multiple errors apply, relay MUST check in this order and return the first matching error:

1. **Header parse** — If header is malformed or truncated → `malformed_frame`, SID=0
2. **Payload size** — If length exceeds limit → `payload_too_large`, SID=0
3. **Frame type** — If type byte unknown → `invalid_frame_type`, SID=0
4. **SessionID validity** — If session-bound frame has SessionID=0, or Ping/Pong has non-zero SessionID → `invalid_session_id`, SID=0
5. **Frame direction** — If sender not allowed for frame type → `disallowed_sender`, SID=header's SessionID (now validated non-zero for session-bound frames)

This order ensures deterministic error selection and correct SID in responses.

### 13.4 Payload Formats

Payload structure is defined per frame type. These formats are parsed by endpoints, never by relay.

**HandshakeInit (`0x01`)** — 32 bytes:

```text
┌─────────────────────────┐
│ initPublicKey (32B)     │  X25519 ephemeral public key
└─────────────────────────┘
```

**HandshakeAccept (`0x02`)** — 96 bytes:

```text
┌─────────────────────────┐
│ acceptPublicKey (32B)   │  X25519 ephemeral public key
├─────────────────────────┤
│ signature (64B)         │  Ed25519 signature (see §6.4)
└─────────────────────────┘
```

**Data (`0x03`)** — variable length:

```text
┌─────────────────────────┐
│ nonce (12B)             │  See §6.6 for nonce construction
├─────────────────────────┤
│ ciphertext (N bytes)    │  ChaCha20-Poly1305 encrypted payload
├─────────────────────────┤
│ authTag (16B)           │  Poly1305 authentication tag
└─────────────────────────┘
```

Total payload size: 28 + plaintext length. Max plaintext: 65508 bytes (64 KB payload limit − 28 bytes overhead).

**Signal (`0x04`)** — 2 bytes (daemon-originated only):

```text
┌─────────────────────────┐
│ signal (1B)             │  Signal code (see below)
├─────────────────────────┤
│ reason (1B)             │  Reason code (for extensibility)
└─────────────────────────┘
```

Signal codes:

| Signal  | Value  | Meaning                                 |
| ------- | ------ | --------------------------------------- |
| `ready` | `0x00` | Session state retained, ready to resume |
| `close` | `0x01` | Session terminated                      |

Reason codes (universal across all signals):

| Reason       | Value  | Meaning                         |
| ------------ | ------ | ------------------------------- |
| `none`       | `0x00` | No specific reason (default)    |
| `state_lost` | `0x01` | Process restart, memory cleared |
| `shutdown`   | `0x02` | Graceful daemon shutdown        |
| `policy`     | `0x03` | Internal policy denial          |
| `error`      | `0x04` | Internal daemon error           |

For `ready` signal, reason SHOULD be `0x00` (`none`). For `close` signal, use the appropriate reason. Unknown reason codes MUST be treated as `none` by relay.

**Ping (`0x10`)** — 0-8 bytes:

```text
┌─────────────────────────┐
│ payload (0..8B)         │  Optional nonce/timestamp for RTT
└─────────────────────────┘
```

Ping is connection-scoped (SessionID = 0). Payload is opaque; recipient copies it to Pong response.

**Pong (`0x11`)** — 0-8 bytes:

```text
┌─────────────────────────┐
│ payload (0..8B)         │  Copied from corresponding Ping
└─────────────────────────┘
```

Pong is connection-scoped (SessionID = 0). Payload MUST match the triggering Ping.

**Control (`0x20`)** — variable length (relay-originated only):

```text
┌─────────────────────────┐
│ code (2B)               │  Control code (big-endian uint16, see §14)
├─────────────────────────┤
│ message (0..N bytes)    │  UTF-8 diagnostic message (optional)
└─────────────────────────┘
```

::: warning Control Message Constraints
The `message` field is for diagnostic/logging purposes only. Relay implementations:

- MUST NOT include identifiers (daemonId, clientId, sessionId, tokens) in message
- SHOULD leave message empty in production
- MAY include generic error descriptions for debugging

Clients MUST NOT parse message content for behavioral decisions; use only the `code` field.
:::

### 13.5 Control Code Mapping

Control frames (`0x20`) are relay-originated only. Endpoint-detected errors (cryptographic failures) are not transmitted as Control frames; endpoints close the connection and log the error locally.

Control codes use **ranges** to categorize error types and session states. Ranges enable **category discrimination only**—do not infer terminality or SessionID scope from the range; consult the per-code table in §14.1.

| Range           | Category       | Description                    |
| --------------- | -------------- | ------------------------------ |
| `0x01xx`        | Authentication | Token and authorization errors |
| `0x02xx`        | Routing        | Daemon discovery and presence  |
| `0x03xx`        | Session        | Session lifecycle errors       |
| `0x04xx`        | Wire format    | Protocol violations            |
| `0x05xx`        | Reserved       | Future use                     |
| `0x06xx`        | Internal       | Relay internal errors          |
| `0x07xx–0x08xx` | Reserved       | Future use                     |
| `0x09xx`        | Rate limiting  | Throttling (recoverable)       |
| `0x0Axx–0x0Fxx` | Reserved       | Future use                     |
| `0x10xx`        | Session state  | Non-terminal state transitions |
| `0x11xx–0x1Fxx` | Reserved       | Future state notifications     |
| `0xE0xx`        | SDK-only       | Never transmitted on wire      |

**Terminality is per-code, not per-range.** See §14 for the complete code table with terminal/non-terminal annotations per code. Terminal codes result in relay closing the WebSocket; non-terminal codes allow the connection to remain open.

### 13.6 Example: Complete Handshake

```text
Client → Relay → Daemon:
  Frame: 01 00000020 0000000000000001 <32 bytes initPublicKey>
         │  │        │                └─ Payload
         │  │        └─ SessionID = 1
         │  └─ Length = 32
         └─ Type = HandshakeInit

Daemon → Relay → Client:
  Frame: 02 00000060 0000000000000001 <32 bytes acceptPublicKey><64 bytes signature>
         │  │        │                └─ Payload (96 bytes)
         │  │        └─ SessionID = 1
         │  └─ Length = 96
         └─ Type = HandshakeAccept

Client → Relay → Daemon (first encrypted message):
  Frame: 03 0000003C 0000000000000001 <12 bytes nonce><32 bytes ciphertext><16 bytes tag>
         │  │        │                └─ Payload (60 bytes)
         │  │        └─ SessionID = 1
         │  └─ Length = 60
         └─ Type = Data

Keepalive (connection-scoped):
  Frame: 10 00000008 0000000000000000 <8 bytes timestamp>
         │  │        │                └─ Payload (optional RTT nonce)
         │  │        └─ SessionID = 0 (connection-scoped)
         │  └─ Length = 8
         └─ Type = Ping

Daemon → Relay (session resumption):
  Frame: 04 00000002 0000000000000001 00 00
         │  │        │                │  └─ reason = 0x00 (none)
         │  │        │                └─ signal = ready (0x00)
         │  │        └─ SessionID = 1
         │  └─ Length = 2
         └─ Type = Signal
```

## 14. Control Codes

This section defines the complete Control code space. Codes are transmitted in Control frames (`0x20`) from relay to endpoint. See §13.5 for code range semantics.

### 14.1 Wire Codes (Relay → Endpoint)

Each code specifies its terminality (T=terminal, closes WebSocket; N=non-terminal, connection stays open) and SessionID scope (0=zero/connection-level, S=session-specific non-zero).

**Authentication (0x01xx)**

| Code   | Name           | T/N | SID | Meaning                    | When Emitted             |
| ------ | -------------- | --- | --- | -------------------------- | ------------------------ |
| 0x0101 | `unauthorized` | T   | 0   | Invalid or expired token   | Token validation failure |
| 0x0102 | `forbidden`    | T   | 0   | Valid token, access denied | User doesn't own daemon  |

**Routing (0x02xx)**

| Code   | Name               | T/N | SID | Meaning              | When Emitted                    |
| ------ | ------------------ | --- | --- | -------------------- | ------------------------------- |
| 0x0201 | `daemon_not_found` | T   | S   | Unknown daemon ID    | Daemon doesn't exist            |
| 0x0202 | `daemon_offline`   | N   | S   | Daemon not connected | Client connects, daemon offline |

**Session (0x03xx)**

| Code   | Name                | T/N | SID | Meaning            | When Emitted                            |
| ------ | ------------------- | --- | --- | ------------------ | --------------------------------------- |
| 0x0301 | `session_not_found` | T   | S   | Unknown session ID | Frame references invalid session        |
| 0x0302 | `session_expired`   | T   | S   | Session terminated | Grace expired, Signal(close), or policy |

**Wire Format (0x04xx)**

| Code   | Name                 | T/N | SID | Meaning                     | When Emitted                               |
| ------ | -------------------- | --- | --- | --------------------------- | ------------------------------------------ |
| 0x0401 | `malformed_frame`    | T   | 0   | Invalid header structure    | Header parse failure, truncated frame      |
| 0x0402 | `payload_too_large`  | T   | 0   | Exceeds 64KB limit          | Payload length > MAX_PAYLOAD_SIZE          |
| 0x0403 | `invalid_frame_type` | T   | 0   | Unknown type byte           | Type byte not in defined set               |
| 0x0404 | `invalid_session_id` | T   | 0   | SessionID invalid for frame | Session-bound with 0, or Ping/Pong with >0 |
| 0x0405 | `disallowed_sender`  | T   | S   | Wrong direction for frame   | Client sends Signal, peer sends Control    |

**Internal (0x06xx)**

| Code   | Name             | T/N | SID | Meaning                | When Emitted                                         |
| ------ | ---------------- | --- | --- | ---------------------- | ---------------------------------------------------- |
| 0x0601 | `internal_error` | T   | 0   | Relay internal failure | Unrecoverable relay error (bug, resource exhaustion) |

**Rate Limiting (0x09xx)**

| Code   | Name           | T/N | SID | Meaning           | When Emitted          |
| ------ | -------------- | --- | --- | ----------------- | --------------------- |
| 0x0901 | `rate_limited` | N   | 0   | Too many requests | Message rate exceeded |

Rate limiting is connection-level per §8.6, so SID=0 regardless of which session triggered the limit.

**Session State (0x10xx)**

| Code   | Name              | T/N | SID | Direction      | Meaning                                   |
| ------ | ----------------- | --- | --- | -------------- | ----------------------------------------- |
| 0x1001 | `session_paused`  | N   | S   | Relay → Client | Daemon disconnected; traffic suspended    |
| 0x1002 | `session_resumed` | N   | S   | Relay → Client | Daemon reconnected and ready              |
| 0x1003 | `session_ended`   | N   | S   | Relay → Daemon | Client disconnected; cleanup session      |
| 0x1004 | `session_pending` | N   | S   | Relay → Client | Daemon reconnected; awaiting ready signal |

### 14.2 Endpoint Codes (SDK Only, Never on Wire)

These codes exist for SDK error handling and logging. They are never transmitted in Control frames.

| Code   | Name                   | Detected by | Meaning                               |
| ------ | ---------------------- | ----------- | ------------------------------------- |
| 0xE001 | `identity_key_changed` | Client      | TOFU key mismatch; possible MITM      |
| 0xE002 | `handshake_failed`     | Client      | Signature verification failed         |
| 0xE003 | `handshake_timeout`    | Either      | 30s handshake deadline exceeded       |
| 0xE004 | `decrypt_failed`       | Either      | ChaCha20-Poly1305 decrypt/auth failed |
| 0xE005 | `sequence_error`       | Either      | Sequence outside replay window        |

Endpoint codes use the `0xExxx` range to clearly distinguish them from wire codes.

**Reserved ranges for endpoint codes:**

- `0xE0xx`: SBRP v1 SDK codes (allocated above)
- `0xE1xx–0xEFxx`: Reserved for future SDK versions
- `0xF0xx–0xFFxx`: Reserved for vendor/application-specific SDK codes

::: danger identity_key_changed
When `identity_key_changed` is detected, client UX MUST:

1. Abort the connection immediately
2. Present both stored and new fingerprints prominently
3. Require explicit user confirmation before accepting new key
4. Log the event with both fingerprints for audit
   :::

### 14.3 Interpreting T/N and SID Columns

**Terminality (T/N):**

- **T (Terminal):** Relay sends Control frame then closes WebSocket. Client should not retry on same connection.
- **N (Non-terminal):** Connection remains open. Client may wait, retry, or take appropriate action.

**SessionID scope (SID):**

- **0:** Connection-level error; use SessionID=0 in frame header.
- **S:** Session-specific; use the relevant non-zero SessionID in frame header.

## 15. Implementation Notes

::: code-group

```typescript [Daemon (Bun/Node)]
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { concatBytes } from "@noble/hashes/utils";

// Identity key (generated once, stored with 0600 permissions)
const identityPrivate = ed25519.utils.randomPrivateKey();
const identityPublic = ed25519.getPublicKey(identityPrivate);

// Session key (generated per handshake)
const ephemeralPrivate = x25519.utils.randomPrivateKey();
const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);

// Sign ephemeral key with context binding
const signaturePayload = sha256(
  concatBytes(
    new TextEncoder().encode("sbrp-v1-handshake"),
    new TextEncoder().encode(daemonId),
    clientEphemeralPublicKey,
    ephemeralPublic,
  ),
);
const signature = ed25519.sign(signaturePayload, identityPrivate); // [!code focus]

// Derive session keys using transcript hash
const shared = x25519.getSharedSecret(
  ephemeralPrivate,
  clientEphemeralPublicKey,
);
const transcriptHash = sha256(
  concatBytes(
    new TextEncoder().encode("sbrp-v1-transcript"),
    new TextEncoder().encode(daemonId),
    clientEphemeralPublicKey,
    ephemeralPublic,
    signature,
  ),
);
const keys = hkdf(sha256, shared, transcriptHash, "sbrp-session-keys", 64); // [!code focus]
const clientToDaemonKey = keys.slice(0, 32);
const daemonToClientKey = keys.slice(32, 64);

// Best-effort zeroization (JS/GC limitations apply)
ephemeralPrivate.fill(0);
shared.fill(0);
```

```typescript [Client (Browser)]
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { concatBytes } from "@noble/hashes/utils";

// TOFU: Load pinned identity key or store on first connection
// NOTE: Production implementations SHOULD use IndexedDB for durability;
// localStorage shown here for simplicity. See §3.3 for storage requirements.
const storageKey = `sbrp.daemon.${daemonId}.identityKey`;
const pinnedKey = localStorage.getItem(storageKey); // [!code focus]
if (pinnedKey && pinnedKey !== base64Encode(daemonIdentityPublic)) {
  // [!code focus]
  throw new Error("identity_key_changed: Daemon key mismatch - possible MITM"); // [!code focus]
} // [!code focus]
if (!pinnedKey) {
  localStorage.setItem(storageKey, base64Encode(daemonIdentityPublic));
}

// Verify daemon signature using PINNED key
const signaturePayload = sha256(
  concatBytes(
    new TextEncoder().encode("sbrp-v1-handshake"),
    new TextEncoder().encode(daemonId),
    myEphemeralPublic,
    daemonEphemeralPublic,
  ),
);
const valid = ed25519.verify(signature, signaturePayload, daemonIdentityPublic); // [!code focus]
if (!valid) throw new Error("Signature verification failed"); // [!code focus]

// Derive session keys using same transcript hash as daemon
const shared = x25519.getSharedSecret(
  myEphemeralPrivate,
  daemonEphemeralPublic,
);
const transcriptHash = sha256(
  concatBytes(
    new TextEncoder().encode("sbrp-v1-transcript"),
    new TextEncoder().encode(daemonId),
    myEphemeralPublic,
    daemonEphemeralPublic,
    signature,
  ),
);
const keys = hkdf(sha256, shared, transcriptHash, "sbrp-session-keys", 64); // [!code focus]
const clientToDaemonKey = keys.slice(0, 32);
const daemonToClientKey = keys.slice(32, 64);
```

:::

### 15.1 Relay (Cloudflare Workers)

```typescript
// Relay only handles routing and auth, no crypto
// Use Durable Objects for connection state
export class RelayDO implements DurableObject {
  connections: Map<string, WebSocket>;

  async handleMessage(from: string, frame: ArrayBuffer) {
    // Parse header only (13 bytes): type, length, sessionId
    const header = new DataView(frame, 0, 13);
    const type = header.getUint8(0);

    // Control frames (Ping/Pong/Error) are handled locally, not forwarded
    if (type === 0x10 || type === 0x11 || type === 0x20) {
      this.handleControlFrame(from, type, frame);
      return;
    }

    // Forward session-bound frames (HandshakeInit, HandshakeAccept, Encrypted)
    const sessionId = header.getBigUint64(5);
    const target = this.getTargetBySession(sessionId);
    target.send(frame);
  }
}
```

## Appendix A. Threat Model Summary

| Threat                 | Attacker | Mitigation                        | Result                                |
| ---------------------- | -------- | --------------------------------- | ------------------------------------- |
| Read messages          | Relay    | ChaCha20-Poly1305                 | Cannot decrypt                        |
| MITM handshake         | Relay    | Ed25519 signatures + TOFU pinning | Cannot forge (after first connection) |
| Key substitution       | Relay    | TOFU identity pinning             | Detected on subsequent connections    |
| Replay messages        | Network  | Bitmap sequence window            | Rejected                              |
| Impersonate daemon     | Relay    | No private key access             | Cannot sign                           |
| Cross-daemon confusion | Relay    | daemonId in signature payload     | Rejected                              |
| Deny service           | Relay    | N/A                               | Accepted risk                         |

## Appendix B. Security Checklist

**Daemon:**

- [ ] Generate Ed25519 identity key on first run
- [ ] Store identity private key with 0600 permissions
- [ ] Include daemonId in signature payload (context binding)
- [ ] Sign every ephemeral key with identity key
- [ ] Use transcript hash as HKDF salt
- [ ] Generate fresh X25519 ephemeral per session
- [ ] Use directional keys (prevent reflection)
- [ ] Implement bitmap-based sliding window (≥64 messages)
- [ ] Send `Signal(ready)` for sessions with retained state after reconnect
- [ ] Send `Signal(close)` for sessions with lost state after reconnect
- [ ] Best-effort zero ephemeral keys and shared secrets after derivation
- [ ] Best-effort clear all key material on session close

**Client:**

- [ ] Pin identity key on first connection (TOFU)
- [ ] Reject connections if identity key changes
- [ ] Verify signature using pinned key, not freshly-fetched key
- [ ] Include daemonId in signature verification payload
- [ ] Use same transcript hash derivation as daemon
- [ ] Handle `Control(session_paused/resumed/pending)` state transitions
- [ ] Handle `Control(session_expired)` by initiating full reconnect

**Relay:**

- [ ] Implement rate limiting
- [ ] Validate daemon ownership before routing
- [ ] Wait for `Signal(ready)` from daemon before sending `Control(session_resumed)` to client
- [ ] Send `Control(session_pending)` to client when daemon reconnects
- [ ] Never log or inspect encrypted message payloads
- [ ] Never include identifiers in Control message text
- [ ] Respond to Ping with Pong, copying payload; never forward Ping/Pong

## Appendix C. Relay Authentication

This appendix defines the token-based authentication contract between the control plane and relay data plane.

### C.1 Architecture Separation

SBRP separates concerns between two planes:

| Plane             | Responsibility                                                | Example Endpoint            |
| ----------------- | ------------------------------------------------------------- | --------------------------- |
| **Control Plane** | User auth, daemon registry, session brokering, token issuance | `api.sideband.cloud`        |
| **Data Plane**    | Frame routing, presence, token validation                     | `eu-1.relay.sideband.cloud` |

The control plane issues tokens that grant relay access: short-lived **session tokens** for clients and long-lived **presence tokens** for daemons. The relay validates tokens but NEVER issues them.

### C.2 Token Claims

Tokens are JWTs signed by the control plane. The relay MUST validate these claims:

```typescript
interface RelayTokenClaims {
  // Standard JWT claims
  iss: string; // MUST match configured issuer (e.g., "https://sideband.cloud")
  aud: string; // MUST be "sideband-relay"
  exp: number; // Unix timestamp; session tokens SHOULD use TTL ≤ 120s (MUST NOT exceed 300s); presence tokens SHOULD use TTL ≥ 1h
  iat: number; // Issued-at timestamp
  jti: string; // Unique token ID (for audit logging)

  // SBRP-specific claims
  sid?: string; // Session ID (base64url of uint64); REQUIRED for clients, omitted for daemons
  role: "daemon" | "client";
  did: string; // Daemon ID (REQUIRED for both roles)
  cid?: string; // Client ID (REQUIRED if role === "client")

  // Optional claims
  region?: string; // Relay region binding (hard fail if mismatch)
  res?: boolean; // Resumable (daemon only); false disables session resumption (default: true)
  scp?: string[]; // Scopes (reserved for future use, ignored in v1)
}
```

### C.3 Validation Rules

The relay MUST:

1. Verify JWT signature using JWKS from control plane
2. Reject tokens where `iss` doesn't match configured issuer
3. Reject tokens where `aud` !== `"sideband-relay"`
4. Reject tokens where `exp` < current time (with ≤30s clock skew tolerance)
5. Reject tokens where `role` is missing or invalid
6. Reject tokens where `did` is missing
7. Reject tokens where `role === "client"` and `cid` is missing
8. Reject tokens where `role === "client"` and `sid` is missing
9. If `region` claim is present, reject if it doesn't match relay's configured region

The relay MUST NOT:

- Track `jti` values for revocation or deduplication (expiration handles token lifetime; audit logging per §C.8 is permitted)
- Accept session tokens with TTL > 300 seconds
- Issue tokens under any circumstances
- Disconnect established WebSocket connections due to token expiry (tokens are validated at connection time only; session lifetime is managed by application-level mechanisms)

### C.4 Key Rotation

The control plane publishes signing keys via JWKS endpoint:

```text
GET https://sideband.cloud/.well-known/jwks.json
```

The relay SHOULD:

- Cache JWKS for up to 5 minutes
- Refresh JWKS when encountering unknown `kid` (key ID)
- Support at least 2 concurrent keys for rotation

### C.5 Connection Flow

```text
┌─────────┐         ┌─────────────┐         ┌─────────┐
│ Client  │         │Control Plane│         │  Relay  │
└────┬────┘         └──────┬──────┘         └────┬────┘
     │                     │                     │
     │ POST /sessions      │                     │
     │ {daemonId}          │                     │
     ├────────────────────►│                     │
     │                     │                     │
     │ {relay_url, token}  │                     │
     │◄────────────────────┤                     │
     │                     │                     │
     │ WSS /relay?token=...│                     │
     ├─────────────────────┼────────────────────►│
     │                     │                     │
     │                     │      validate token │
     │                     │      pair by sid    │
     │                     │                     │
     │◄════════════════════ E2EE frames ════════►│
```

Tokens are passed either:

- Query parameter: `wss://eu-1.relay.../relay?token=<jwt>`
- Authorization header: `Authorization: Bearer <jwt>`

### C.6 Session Binding

For client connections, the `sid` (session ID) in the token MUST match the `SessionID` field in session-bound frames sent by the client (`0x01`, `0x03`). Note: `0x02` is daemon→client only; `0x04` (Signal) from clients is rejected as `disallowed_sender` per §13.3. Daemon presence connections (sid omitted) are exempt—they handle multiple sessions via relay-managed pairing. Relay-generated Control frames (`0x20`) and connection-scoped frames (`0x10`, `0x11`) are not subject to token sid matching.

**Session ID format:**

- Wire format: 64-bit unsigned integer (big-endian in frame header)
- JWT `sid` claim: base64url encoding of the 8-byte big-endian uint64 (no padding)

```text
Token claims: { sid: "AAALOnPOL_I", role: "client", did: "d_xyz" }
                    │
                    ▼ base64url decode → 8 bytes → uint64
Frame header: SessionID = 0x00000B3A73CE2FF2
```

Session IDs MUST be non-zero for session-bound frames (HandshakeInit, HandshakeAccept, Data, Signal per §13.2). Control frames use non-zero SessionID for session events, zero for connection errors. Ping and Pong frames MUST use SessionID = 0 (connection-scoped).

### C.7 Daemon Presence Tokens

Daemons connect with a long-lived presence token that has additional constraints:

- `role` = `"daemon"`
- `sid` is omitted (presence-only connection)
- `res` (optional): `false` to disable session resumption (default: `true`)
- Daemon accepts incoming sessions routed by relay

**Non-resumable daemons**: When `res: false`, the relay automatically sends `Control(session_expired)` to all paired clients upon daemon reconnect, without waiting for `Signal(ready)` or `Signal(close)`. This simplifies v1 implementations that don't need resumption—the daemon doesn't need to track session IDs or send per-session Signal frames on reconnect.

When a client initiates a session, the relay validates the client's session token and routes the `HandshakeInit` frame to the daemon. The daemon identifies the session via the `SessionID` field in the frame header (§13.1) and uses this to key per-client state (§12.2). The daemon trusts the relay to have validated the client's authorization; it does not receive or verify the client's JWT token directly.

### C.8 Audit Requirements

For SOC2/compliance, implementations SHOULD:

- Log `jti` for all token validations (success and failure)
- Log session creation/termination with `sid`, `did`, `cid`
- Retain logs for configured retention period
- Never log token values or session content
