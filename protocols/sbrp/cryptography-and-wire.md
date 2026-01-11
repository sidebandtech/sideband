---
url: /protocols/sbrp/cryptography-and-wire.md
---
# Cryptography and Wire Format

> **Authority**: Primary (Normative)\
> **Purpose**: Cryptographic construction, key derivation, and binary frame layout for SBRP.

## 1. Cryptographic Construction

### 1.1 Primitives

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

### 1.2 Actors and Authentication

SBRP uses two-tier authentication: the **control plane** handles user/daemon registration and session brokering; the **data plane** (relay) validates tokens for WebSocket connections.

**User**: Authenticates to control plane via OAuth, passkeys, or session-based auth. Obtains relay tokens for WebSocket connections. Can register multiple daemons and connect from multiple devices.

**Daemon**: Registers with control plane via API key. Has Ed25519 identity keypair (signs handshakes). Identity public key is registered with control plane; clients fetch it from there.

**Client**: Authenticates to control plane via user session. Generates ephemeral X25519 keys per connection. Verifies daemon signatures using locally pinned identity key (TOFU).

### 1.3 E2EE Handshake

After WebSocket connection, client and daemon perform authenticated key exchange using binary frames.

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

### 1.4 Signature Verification

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

Client verifies using **pinned** identity key (see [index.md](./index.md#_3-3-identity-key-trust-tofu)):

```text
valid = Ed25519.verify(pinnedIdentityPublicKey, signaturePayload, signature)
```

If verification fails, abort handshake immediately.

**Handshake timeout:** Handshake SHOULD complete within 30 seconds. Client measures from WebSocket open; daemon measures from receiving `HandshakeInit`. Implementations MUST abort with `handshake_failed` if the timeout expires.

**Why this prevents MITM:**

1. Client uses locally-pinned identity key (TOFU), not freshly-fetched key
2. Relay doesn't have the daemon's Ed25519 private key
3. Signature binds to specific daemonId, preventing cross-daemon confusion
4. Signature binds to specific clientEphemeralPublicKey, preventing replay

**Design note:** The relay origin is not included in the signature payload because daemonId is globally unique within the control plane's namespace. Token claims (`did`, optional `region`) bind sessions to specific daemons and relays. Cross-region replay is prevented by the `region` claim validation at token verification time, not at the cryptographic layer.

### 1.5 Key Derivation

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

* HKDF info parameter MUST be the protocol-defined constant "sbrp-session-keys"
* Transcript hash as salt binds keys to this specific authenticated session
* Including signature ensures derived keys are tied to verified identity
* Directional keys prevent reflection attacks
* Transcript context string provides domain separation

## 2. Runtime Cryptographic Invariants

### 2.1 Encrypted Messages

All application messages after handshake use binary `Encrypted` frames (type `0x03`). The encrypted payload structure:

```text
nonce (12 bytes) || ciphertext || authTag (16 bytes)
```

### 2.2 Nonce Construction

* Bytes 0-3: Direction (`0x00000001` = client→daemon, `0x00000002` = daemon→client)
* Bytes 4-11: Sequence number (big-endian uint64)

### 2.3 Additional Authenticated Data (AAD)

* AAD MUST be empty (zero-length byte array)
* Context binding is achieved via nonce (direction + sequence) and key derivation (transcript hash includes handshake data)
* Implementations MUST NOT use non-empty AAD

### 2.4 Sequence Numbers

* Start at 0, increment per message per direction
* Sequence number space is 64-bit; replay window is an implementation-defined sliding subset
* Receiver MUST use bitmap-based sliding window of at least 64 messages
* Receiver SHOULD use window size at least 128
* Receiver MAY use 256 or larger for high-latency or bursty traffic
* Messages outside window are rejected
* Bitmap approach prevents memory exhaustion from attacker-controlled sequence numbers
* Large sequence jumps (beyond window size) MUST be handled in O(1) by resetting the bitmap rather than iterating; failure to do so enables CPU exhaustion attacks

### 2.5 Replay Window Implementation

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

## 3. Wire Format and Frame Layout

All relay communication uses binary frames over WebSocket (binary message type). The relay inspects ONLY the frame header for routing decisions; payload content is opaque bytes that the relay MUST NOT interpret.

### 3.1 Frame Structure

```text
┌───────────┬──────────────┬────────────────┬─────────────────────┐
│ Type (1B) │ Length (4B)  │ SessionID (8B) │ Payload (0..64KB)   │
└───────────┴──────────────┴────────────────┴─────────────────────┘
     │            │               │                  │
     │            │               │                  └─ Opaque bytes (handshake or encrypted)
     │            │               └─ Session ID (big-endian uint64)
     │            └─ Payload length in bytes (big-endian uint32, excludes header)
     └─ Frame type (see §3.2)
```

* **Header size:** 13 bytes (fixed)
* **Max payload:** 65536 bytes (64 KB)
* **Byte order:** Big-endian for all multi-byte integers

### 3.2 Frame Types

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

* Session-bound frames (`0x01`, `0x02`, `0x03`, `0x04`) MUST have non-zero SessionID
* Keepalive frames (`0x10`, `0x11`) MUST have SessionID = 0 (connection-scoped, never forwarded)
* Control frames (`0x20`) use non-zero SessionID for session events, zero for connection errors

**SessionID scope by Control code:** See [control-codes.md](./control-codes.md) for the authoritative per-code SID column. Connection-level errors (SID=0) have no valid session context; session-specific events (SID=S) use the relevant non-zero SessionID.

**Authority boundaries:**

* Clients MUST NOT send Signal (`0x04`) or Control (`0x20`) frames
* Endpoints MUST NOT send Control (`0x20`) frames
* Relay MUST reject disallowed frames with `Control(disallowed_sender)` if header is parseable; if header is malformed or truncated, close WebSocket immediately with `Control(malformed_frame, SessionID=0)`

### 3.3 Payload Formats

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
│ signature (64B)         │  Ed25519 signature (see §1.4)
└─────────────────────────┘
```

**Data (`0x03`)** — variable length:

```text
┌─────────────────────────┐
│ nonce (12B)             │  See §2.2 for nonce construction
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
│ code (2B)               │  Control code (big-endian uint16, see control-codes.md)
├─────────────────────────┤
│ message (0..N bytes)    │  UTF-8 diagnostic message (optional)
└─────────────────────────┘
```

::: warning Control Message Constraints
The `message` field is for diagnostic/logging purposes only. Relay implementations:

* MUST NOT include identifiers (daemonId, clientId, sessionId, tokens) in message
* SHOULD leave message empty in production
* MAY include generic error descriptions for debugging

Clients MUST NOT parse message content for behavioral decisions; use only the `code` field.
:::

### 3.4 Control Code Ranges

Control frames (`0x20`) are relay-originated only. Endpoint-detected errors (cryptographic failures) are not transmitted as Control frames; endpoints close the connection and log the error locally.

Control codes use **ranges** to categorize error types and session states. Ranges enable **category discrimination only**—do not infer terminality or SessionID scope from the range; consult [control-codes.md](./control-codes.md) for the per-code table.

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

**Terminality is per-code, not per-range.** See [control-codes.md](./control-codes.md) for the complete code table with terminal/non-terminal annotations per code. Terminal codes result in relay closing the WebSocket; non-terminal codes allow the connection to remain open.

## 4. Wire-Level Validation Rules

### 4.1 Relay Behavior

The relay MUST:

* Parse frame header (13 bytes) to extract type, length, and session ID
* Route endpoint frames (`0x01`, `0x02`, `0x03`) by session ID to the paired connection
* Handle `Signal` (`0x04`) from daemon:
  * `Signal(ready)`: send `Control(session_resumed)` to client, resume routing
  * `Signal(close)`: send `Control(session_expired)` to client, close session pairing
* Handle `Ping` (`0x10`) locally: respond with `Pong` copying payload; NEVER forward
* Handle `Pong` (`0x11`) locally: update liveness state; NEVER forward
* Reject `Control` (`0x20`) received from peers as `disallowed_sender`
* Reject `Signal` (`0x04`) received from clients as `disallowed_sender`
* Generate `Control` frames as needed
* Forward payload bytes of routed frames without modification
* Reject frames exceeding max payload size with `Control(payload_too_large)`

The relay MUST NOT:

* Interpret payload contents of endpoint frames
* Parse any structure within encrypted payloads
* Buffer, reassemble, or coalesce frames beyond transport requirements
* Modify frame bytes in transit
* Generate Control messages that leak information derived from encrypted payloads
* Include identifiers (daemonId, clientId, sessionId, tokens) in Control message text

::: warning Relay is a Frame Router
The relay operates on opaque binary frames. It has no knowledge of handshake semantics, encryption, or application protocols. This separation is intentional and MUST be preserved.
:::

### 4.2 Frame Validation Order

When multiple errors apply, relay MUST check in this order and return the first matching error:

1. **Header parse** — If header is malformed or truncated → `malformed_frame`, SID=0
2. **Payload size** — If length exceeds limit → `payload_too_large`, SID=0
3. **Frame type** — If type byte unknown → `invalid_frame_type`, SID=0
4. **SessionID validity** — If session-bound frame has SessionID=0, or Ping/Pong has non-zero SessionID → `invalid_session_id`, SID=0
5. **Frame direction** — If sender not allowed for frame type → `disallowed_sender`, SID=header's SessionID (now validated non-zero for session-bound frames)

This order ensures deterministic error selection and correct SID in responses.

## 5. Examples

### 5.1 Complete Handshake

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

### 5.2 Nonce Encoding Example

Client sending first message to daemon:

```text
Direction: 0x00000001 (client → daemon)
Sequence:  0x0000000000000000 (first message)

Nonce (12 bytes): 00 00 00 01 00 00 00 00 00 00 00 00
```

Daemon sending first response:

```text
Direction: 0x00000002 (daemon → client)
Sequence:  0x0000000000000000 (first message in this direction)

Nonce (12 bytes): 00 00 00 02 00 00 00 00 00 00 00 00
```

### 5.3 Control Frame Example

Session paused notification:

```text
Frame: 20 00000002 0000000000000001 10 01
       │  │        │                │
       │  │        │                └─ code = 0x1001 (session_paused)
       │  │        └─ SessionID = 1
       │  └─ Length = 2
       └─ Type = Control
```

With optional diagnostic message:

```text
Frame: 20 00000016 0000000000000001 10 01 "Daemon disconnected"
       │  │        │                │     └─ UTF-8 message (optional)
       │  │        │                └─ code = 0x1001 (session_paused)
       │  │        └─ SessionID = 1
       │  └─ Length = 22 (2 bytes code + 20 bytes message)
       └─ Type = Control
```
