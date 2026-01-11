# @sideband/secure-relay

Low-level E2EE primitives for the Sideband Relay Protocol (SBRP).

Implements authenticated handshake, key derivation, and message encryption for secure browser ↔ daemon communication via untrusted relay servers. Most applications should use `@sideband/peer` instead of this package directly.

## Features

- **Ed25519 signatures** — MITM protection via daemon identity verification
- **X25519 key exchange** — Forward secrecy with ephemeral keys
- **ChaCha20-Poly1305** — Authenticated encryption for all messages
- **TOFU identity pinning** — Trust-on-first-use with key change detection
- **Replay protection** — Bitmap-based sequence window

## Non-Goals

This package intentionally does NOT:

- Handle network transport or WebSockets
- Manage session lifecycle or reconnection
- Persist identity keys or TOFU pins
- Implement relay authentication or tokens

## Install

```bash
bun add @sideband/secure-relay
```

## Usage

```ts
import {
  generateIdentityKeyPair,
  createHandshakeInit,
  processHandshakeInit,
  processHandshakeAccept,
  createClientSession,
  createDaemonSession,
  encryptClientToDaemon,
  decryptClientToDaemon,
  encryptDaemonToClient,
  decryptDaemonToClient,
  asDaemonId,
  asClientId,
} from "@sideband/secure-relay";

// Daemon: generate identity keypair ONCE and persist securely.
// Regenerating causes TOFU mismatch warnings for all clients.
const identity = generateIdentityKeyPair();
const daemonId = asDaemonId("my-daemon");

// Client: initiate handshake
const { message: init, ephemeralKeyPair } = createHandshakeInit();

// Daemon: process init, create accept
const { message: accept, result } = processHandshakeInit(
  init,
  daemonId,
  identity,
);
const clientSession = createClientSession(
  asClientId("client-123"),
  result.sessionKeys,
);

// Client: verify signature against TOFU-pinned key, derive session
const { sessionKeys } = processHandshakeAccept(
  accept,
  daemonId,
  pinnedIdentityKey, // from local storage
  ephemeralKeyPair,
);
const daemonSession = createDaemonSession(sessionKeys);

// Encrypt/decrypt messages (sessions are stateful — do not clone)
const encrypted = encryptClientToDaemon(daemonSession, plaintext);
const decrypted = decryptClientToDaemon(clientSession, encrypted);
```

## TOFU Security

Identity keys use trust-on-first-use (TOFU) pinning:

- Pin daemon identity keys on first successful handshake
- Never accept key changes silently — `identity_key_changed` indicates potential MITM
- On mismatch, present both fingerprints and require explicit user approval

### Detecting Identity Key Changes

Compare the daemon's current identity key against your stored pin before handshake:

```ts
import {
  processHandshakeAccept,
  computeFingerprint,
  SbrpError,
  SbrpErrorCode,
} from "@sideband/secure-relay";

// Load pinned key from storage (null on first connection)
const pinnedKey = await storage.get(`tofu:${daemonId}`);

if (pinnedKey && !equalBytes(pinnedKey, currentIdentityKey)) {
  // Key changed — potential MITM attack
  throw new SbrpError(
    SbrpErrorCode.IdentityKeyChanged,
    `Identity key changed for ${daemonId}. ` +
      `Expected: ${computeFingerprint(pinnedKey)}, ` +
      `Got: ${computeFingerprint(currentIdentityKey)}`,
  );
}

// First connection: pin the key after successful handshake
const result = processHandshakeAccept(
  accept,
  daemonId,
  currentIdentityKey,
  ephemeralKeyPair,
);
if (!pinnedKey) {
  await storage.set(`tofu:${daemonId}`, currentIdentityKey);
}
```

## Error Handling

All errors throw `SbrpError` with a specific `code`:

| Code                   | Meaning                                   | Recovery                  |
| ---------------------- | ----------------------------------------- | ------------------------- |
| `identity_key_changed` | Pinned key doesn't match (potential MITM) | Close session, alert user |
| `handshake_failed`     | Signature verification failed             | Close session             |
| `decrypt_failed`       | Message authentication failed             | Close session             |
| `sequence_error`       | Replay detected or sequence out of window | Close session             |

All errors are fatal — close the session and re-handshake.

## Specification

See the [SBRP protocol specification](https://sideband.tech/protocols/sbrp/) for implementation details.

## License

Apache-2.0
