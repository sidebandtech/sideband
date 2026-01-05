# @sideband/secure-relay

End-to-end encrypted communication between browsers and daemons via untrusted relay servers.

## Features

- **Ed25519 signatures** — MITM protection via daemon identity verification
- **X25519 key exchange** — Forward secrecy with ephemeral keys
- **ChaCha20-Poly1305** — Authenticated encryption for all messages
- **TOFU identity pinning** — Trust-on-first-use with key change detection
- **Replay protection** — Bitmap-based sequence window

## Install

```bash
bun add @sideband/secure-relay
```

## Usage

```typescript
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

// Daemon: generate identity keypair (persist this!)
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

// Encrypt/decrypt messages
const encrypted = encryptClientToDaemon(daemonSession, plaintext);
const decrypted = decryptClientToDaemon(clientSession, encrypted);
```

## Error Handling

All errors throw `SbrpError` with a specific `code`:

| Code                   | Meaning                                   |
| ---------------------- | ----------------------------------------- |
| `identity_key_changed` | Pinned key doesn't match (potential MITM) |
| `handshake_failed`     | Signature verification failed             |
| `decrypt_failed`       | Message authentication failed             |
| `sequence_error`       | Replay detected or sequence out of window |

## Specification

See [Secure Relay Protocol](https://sideband.tech/specs/secure-relay-protocol) for the full protocol specification.

## License

Apache-2.0
