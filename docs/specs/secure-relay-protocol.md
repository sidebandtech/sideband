# Sideband Relay Protocol (SBRP)

**Version:** 0.1.0
**Status:** Draft
**Last Updated:** 2025-01-04

## 1. Overview

SBRP enables secure communication between local daemons (background services, agents, or processes) and browser-based UIs via a relay server. The protocol uses a hybrid trust model:

- **Relay is trusted** for authentication, device management, and routing
- **Relay cannot decrypt** application payloads (end-to-end encrypted)
- **Relay cannot perform undetectable MITM after initial TOFU trust establishment**

This provides persistent multi-device access while ensuring message confidentiality.

::: warning TOFU Limitation
As with SSH-style TOFU systems, the first connection trusts the relay to provide the correct daemon identity key. Subsequent connections are cryptographically protected against relay MITM.
:::

### 1.1 Architecture

```text
┌─────────┐         ┌─────────┐         ┌─────────┐
│ Browser │◄──TLS──►│  Relay  │◄──TLS──►│ Daemon  │
│         │  auth   │ Server  │  auth   │         │
└─────────┘         └─────────┘         └─────────┘
     │                   │                   │
     │      [auth, routing, key registry]    │
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

**Client**: Relay-authenticated session initiator. Generates ephemeral X25519 keys per session. No persistent identity. Verifies daemon via TOFU. May be a browser, CLI, native app, or any non-daemon participant.

**Daemon**: Long-lived agent with Ed25519 identity keypair. Authenticates to relay via API key. Reachable only through relay.

**Relay**: Routing and authentication authority. Not an encryption endpoint.

## 3. Trust Model

### 3.1 What Relay Can Do

- Authenticate users and daemons
- Route connections between them
- See metadata (timing, size, frequency)
- Drop or delay messages (DoS)
- Initiate new sessions toward a daemon on behalf of an authenticated user

### 3.2 What Relay Cannot Do

- Decrypt message content (E2EE)
- Perform undetectable MITM after initial TOFU trust establishment (daemon signs ephemeral keys, client pins identity)
- Forge daemon identity (Ed25519 signatures)

::: info Authentication Scope
SBRP authenticates the daemon to the client, but does not cryptographically authenticate the client to the daemon. This is an accepted trade-off to enable standard web authentication models without client key management.
:::

### 3.3 Identity Key Trust (TOFU)

The client **MUST** persist daemon identity public keys locally using Trust On First Use:

1. **First connection:** Client stores `identityPublicKey` from relay
2. **Subsequent connections:** Client compares relay-provided key against stored key
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

::: danger Key Mismatch = Possible MITM
On mismatch, client MUST abort and present clear warning before allowing user to accept new key.
:::

**Security properties:**

- First connection: Relay could MITM (inherent TOFU limitation)
- Subsequent connections: Relay cannot MITM without user approval

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

### 5.1 User

- Authenticates via OAuth, passkeys, or session-based auth
- Has session cookie for relay API/WebSocket
- Can register multiple daemons
- Can connect from multiple devices

### 5.2 Daemon

- Authenticates via API key (issued per daemon)
- Has Ed25519 identity keypair (signs handshakes)
- Registers identity public key with relay
- Maintains persistent WebSocket to relay

### 5.3 Client

- Authenticates via user session
- Generates ephemeral X25519 keys per connection
- Verifies daemon signatures using locally pinned identity key (TOFU)
- Can connect to any daemon the user owns

## 6. Protocol Flow

### 6.1 Daemon Registration (One-Time)

Daemon generates identity keypair on first run and registers with relay.

```text
Daemon                              Relay
   │                                  │
   │── POST /api/daemons/register ───►│
   │   {                              │
   │     "apiKey": "dk_xxx",          │
   │     "name": "macbook-pro",       │
   │     "identityPublicKey": "..."   │  ← Ed25519 public key
   │   }                              │
   │                                  │
   │◄─── 200 OK ──────────────────────│
   │   {                              │
   │     "daemonId": "d_abc123"       │
   │   }                              │
   │                                  │
   │── WSS /relay?daemon=d_abc123 ───►│  ← Persistent connection
   │   Authorization: Bearer dk_xxx   │
   │                                  │
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

Client lists available daemons and connects.

```text
Client                              Relay
   │                                  │
   │── GET /api/daemons ─────────────►│
   │   Cookie: session=xxx            │
   │                                  │
   │◄─── 200 OK ──────────────────────│
   │   [{                             │
   │     "id": "d_abc123",            │
   │     "name": "macbook-pro",       │
   │     "status": "online",          │
   │     "identityPublicKey": "..."   │  ← Ed25519 public key
   │   }]                             │
   │                                  │
   │── WSS /relay?daemon=d_abc123 ───►│
   │   Cookie: session=xxx            │
   │                                  │
```

Client caches `identityPublicKey` for signature verification.

### 6.3 E2EE Handshake

After WebSocket connection, client and daemon perform authenticated key exchange.

```text
Client                     Relay                    Daemon
   │                         │                         │
   │                    [WebSocket connected]          │
   │                         │                         │
   │── handshake.init ──────►│── forward ─────────────►│
   │   {                     │                         │
   │     "initPublicKey":    │                         │  ← X25519 ephemeral
   │       "<base64>"        │                         │
   │   }                     │                         │
   │                         │                         │
   │                         │                         │  Daemon:
   │                         │                         │  1. Generate X25519 ephemeral
   │                         │                         │  2. Sign ephemeral with Ed25519
   │                         │                         │
   │◄─────────────────────────────── handshake.accept ─│
   │                         │   {                     │
   │                         │     "acceptPublicKey":  │  ← X25519 ephemeral
   │                         │       "<base64>",       │
   │                         │     "signature":        │  ← Ed25519 signature
   │                         │       "<base64>"        │
   │                         │   }                     │
   │                         │                         │
   │  Client:                │                         │
   │  1. Verify signature    │                         │
   │  2. Derive shared secret│                         │
   │                         │                         │
   │◄════════════ E2EE messages ══════════════════════►│
   │   (relay sees encrypted blobs only)               │
```

Future versions MAY support client-held identity keys for cryptographic user authentication; SBRP v1 does not require this.

### 6.4 Signature Verification

Daemon signs its ephemeral public key with context binding:

```text
signaturePayload = SHA256(
  "sbrp-v1-handshake" ||
  daemonId ||
  clientPublicKey ||
  daemonEphemeralPublicKey
)

signature = Ed25519.sign(identityPrivateKey, signaturePayload)
```

Client verifies using **pinned** identity key (see §3.3):

```text
valid = Ed25519.verify(pinnedIdentityPublicKey, signaturePayload, signature)
```

If verification fails → abort handshake immediately.

**Why this prevents MITM:**

1. Client uses locally-pinned identity key (TOFU), not relay-provided key
2. Relay doesn't have the daemon's Ed25519 private key
3. Signature binds to specific daemonId, preventing cross-daemon confusion
4. Signature binds to specific clientPublicKey, preventing replay

**Design note:** The relay origin is not included in the signature payload because daemonId uniqueness is scoped to a single relay instance. Cross-relay attacks require re-registration, which triggers new TOFU pinning.

### 6.5 Key Derivation

Both parties compute:

```text
sharedSecret = X25519(myEphemeralPrivate, peerEphemeralPublic)

// Transcript hash binds session keys to the authenticated handshake
transcriptHash = SHA256(
  "sbrp-v1-transcript" ||
  daemonId ||
  clientPublicKey ||
  daemonPublicKey ||
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

All application messages after handshake:

```json
{
  "type": "encrypted",
  "seq": 42,
  "data": "<base64>"
}
```

Data format (before base64):

```text
nonce (12 bytes) || ciphertext || authTag (16 bytes)
```

**Nonce construction:**

- Bytes 0-3: Direction (`0x00000001` = client→daemon, `0x00000002` = daemon→client)
- Bytes 4-11: Sequence number (big-endian uint64)

**Sequence numbers:**

- Start at 0, increment per message per direction
- Sequence number space is 64-bit; replay window is an implementation-defined sliding subset
- Receiver MUST use bitmap-based sliding window of at least 64 messages
- Receiver SHOULD use window size at least 128
- Receiver MAY use 256 or larger for high-latency or bursty traffic
- Messages outside window are rejected
- Bitmap approach prevents memory exhaustion from attacker-controlled sequence numbers

```typescript
// Bitmap-based sliding window (prevents memory DoS)
interface ReplayWindow {
  maxSeen: bigint; // highest accepted sequence
  bitmap: bigint; // 64-bit window: bit i = maxSeen-i was seen
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

## 7. Message Types

### 7.1 Control Messages (Unencrypted)

Handled by relay, not forwarded:

| Type    | Direction      | Purpose             |
| ------- | -------------- | ------------------- |
| `ping`  | Either         | Keep-alive          |
| `pong`  | Either         | Keep-alive response |
| `error` | Relay → Client | Error notification  |

### 7.2 Handshake Messages (Unencrypted, Forwarded)

| Type               | Direction       | Purpose                              |
| ------------------ | --------------- | ------------------------------------ |
| `handshake.init`   | Client → Daemon | Client's ephemeral X25519 key        |
| `handshake.accept` | Daemon → Client | Daemon's signed ephemeral X25519 key |

### 7.3 Application Messages (Encrypted)

| Type        | Direction | Purpose                  |
| ----------- | --------- | ------------------------ |
| `encrypted` | Either    | E2EE application payload |

The relay forwards these without inspection.

## 8. Relay Server Responsibilities

### 8.1 Authentication

- Validate user sessions
- Validate daemon API keys
- Enforce user → daemon ownership

### 8.2 Key Registry

- Store daemon identity public keys (Ed25519)
- Provide keys to clients on connection
- No access to private keys

### 8.3 Routing

- Maintain WebSocket connections for daemons and clients
- Route messages between paired connections
- Handle multiple clients per daemon

### 8.4 Presence

- Track daemon online/offline status
- Notify clients when daemon disconnects
- Queue messages briefly during reconnection (optional)

### 8.5 Rate Limiting

- Max 100 messages/second per connection
- Max 64 KB per message (decoded binary payload, excluding base64 and JSON overhead)
- Max 10 daemons per user (configurable)
- Max 5 concurrent client connections per daemon

## 9. Quick Connect (Optional)

For scenarios without account (local dev, demos), support ephemeral connect codes:

```text
Daemon                              Relay
   │                                  │
   │── POST /api/connect/code ───────►│
   │   Authorization: Bearer dk_xxx   │
   │                                  │
   │◄─── 200 OK ──────────────────────│
   │   {                              │
   │     "code": "A7F3-KQP9",         │
   │     "expiresAt": "...",          │
   │     "url": "https://relay.example│
   │            /connect/A7F3-KQP9"   │
   │   }                              │
   │                                  │
```

Client navigating to URL gets temporary access without login. Code expires in 5 minutes. E2EE handshake (with signature verification) proceeds normally.

::: warning Reduced Security
Quick Connect provides reduced authentication guarantees. Use only for local development or demos.
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

| Attack               | Mitigation                            |
| -------------------- | ------------------------------------- |
| Relay reads messages | E2EE encryption                       |
| Relay MITM           | Ed25519 signatures on ephemeral keys  |
| Replay attack        | Sequence numbers, sliding window      |
| Reflection attack    | Directional keys                      |
| Key substitution     | Signature binds ephemeral to identity |
| Session hijacking    | Session management via auth provider  |

### 10.3 Limitations

| Attack                         | Status                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| Compromised relay auth         | Can deny service, can't decrypt or MITM                                                      |
| Compromised client runtime     | Full compromise (inherent to web apps for browsers)                                          |
| Traffic analysis               | Relay sees timing, size, frequency; may infer high-level usage patterns                      |
| Daemon identity key compromise | Must rotate key, re-register                                                                 |
| Relay user impersonation       | Relay can initiate sessions as user; client is not cryptographically authenticated to daemon |

### 10.4 Optional Privacy Enhancements (Non-Normative)

Implementations MAY pad encrypted payloads or batch messages to reduce traffic analysis, depending on application needs.

## 11. Reconnection

### 11.1 Daemon Reconnection

If daemon WebSocket disconnects:

1. Daemon reconnects with same API key
2. Relay restores daemon's connection state
3. Client connections remain open (paused)
4. No re-handshake needed if within 30s grace period and session state is still in memory
5. Session resumption is ONLY allowed if session keys, sequence counters, and replay window are still present in memory
6. If the daemon process restarts or loses volatile memory, it MUST NOT attempt to resume a session and MUST force a full handshake
7. If resumed without a full handshake, sequence numbers MUST continue monotonically per direction

### 11.2 Client Reconnection

If client WebSocket disconnects:

1. Client reconnects with same session
2. Full E2EE handshake required (new ephemeral keys)
3. Application should handle state resync

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

// Sessions keyed by clientId from relay
const sessions = new Map<string, ClientSession>();
```

## 13. Wire Format

### 13.1 Envelope

All WebSocket messages are JSON:

```json
{
  "type": "<message-type>",
  ...payload
}
```

Future versions may support binary framing to reduce base64 overhead.

### 13.2 Examples

**Handshake init:**

```json
{
  "type": "handshake.init",
  "initPublicKey": "MCowBQYDK2VuAyEA..."
}
```

**Handshake accept (with signature):**

```json
{
  "type": "handshake.accept",
  "acceptPublicKey": "MCowBQYDK2VuAyEA...",
  "signature": "MEUCIQD..."
}
```

**Encrypted message:**

```json
{
  "type": "encrypted",
  "seq": 1,
  "data": "nonce+ciphertext+tag in base64"
}
```

**Error:**

```json
{
  "type": "error",
  "code": "daemon_offline",
  "message": "Daemon is not connected"
}
```

**Identity key changed error (with fingerprints):**

```json
{
  "type": "error",
  "code": "identity_key_changed",
  "message": "Daemon identity key mismatch",
  "storedFingerprint": "SHA256:AA:BB:...",
  "newFingerprint": "SHA256:CC:DD:..."
}
```

## 14. Error Codes

| Code                   | Meaning                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `unauthorized`         | Invalid session or API key                                                                                                            |
| `daemon_not_found`     | Daemon ID doesn't exist                                                                                                               |
| `daemon_offline`       | Daemon not connected                                                                                                                  |
| `daemon_not_owned`     | User doesn't own this daemon                                                                                                          |
| `identity_key_changed` | Daemon identity key differs from pinned key (possible MITM); UX MUST present both fingerprints and require explicit user confirmation |
| `handshake_failed`     | Signature verification or key exchange failed                                                                                         |
| `decrypt_failed`       | Message decryption failed                                                                                                             |
| `sequence_error`       | Sequence number outside valid window                                                                                                  |
| `rate_limited`         | Too many requests                                                                                                                     |

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
    clientPublicKey,
    ephemeralPublic,
  ),
);
const signature = ed25519.sign(signaturePayload, identityPrivate); // [!code focus]

// Derive session keys using transcript hash
const shared = x25519.getSharedSecret(ephemeralPrivate, clientPublicKey);
const transcriptHash = sha256(
  concatBytes(
    new TextEncoder().encode("sbrp-v1-transcript"),
    new TextEncoder().encode(daemonId),
    clientPublicKey,
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

  async handleMessage(from: string, message: unknown) {
    // Forward handshake and encrypted messages without inspection
    const target = this.getTarget(from);
    target.send(JSON.stringify(message));
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
- [ ] Best-effort zero ephemeral keys and shared secrets after derivation
- [ ] Best-effort clear all key material on session close

**Client:**

- [ ] Pin identity key on first connection (TOFU)
- [ ] Reject connections if identity key changes
- [ ] Verify signature using pinned key, not relay-provided
- [ ] Include daemonId in signature verification payload
- [ ] Use same transcript hash derivation as daemon

**Relay:**

- [ ] Implement rate limiting
- [ ] Validate daemon ownership before routing
- [ ] Never log or inspect encrypted message payloads
