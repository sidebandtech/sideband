# @sideband/peer

## 0.1.0

### Minor Changes

- [#21](https://github.com/sidebandtech/sideband/pull/21) [`c23e3aa`](https://github.com/sidebandtech/sideband/commit/c23e3aacb0cbb45ce95d11a4dbba95cd86a630b3) Thanks [@koistya](https://github.com/koistya)! - Add SBRP E2EE negotiators and `@sideband/peer/sbrp` subpath export

  `@sideband/peer` gains `sbrpClientNegotiator` and `sbrpDaemonNegotiator` via a new
  `@sideband/peer/sbrp` entry point (requires `@sideband/secure-relay` as a peer dep).
  Includes TOFU identity pinning, configurable trust policies (`auto`/`prompt`/`strict`),
  ephemeral key zeroization, and an encrypted channel wrapper with injected crypto ops.

  `@sideband/secure-relay` updates the SBRP handshake wire format: `HandshakeAccept`
  payload grows to 128 bytes and now includes the daemon's Ed25519 identity public key
  inline, removing the need for a separate identity-key frame.

### Patch Changes

- Updated dependencies [[`c23e3aa`](https://github.com/sidebandtech/sideband/commit/c23e3aacb0cbb45ce95d11a4dbba95cd86a630b3)]:
  - @sideband/secure-relay@0.2.3

## 0.0.1

### Patch Changes

- [#19](https://github.com/sidebandtech/sideband/pull/19) [`8d5a332`](https://github.com/sidebandtech/sideband/commit/8d5a332c431de165450018512aa0530dbe118f90) Thanks [@koistya](https://github.com/koistya)! - Implement peer SDK with lifecycle state machine, bidirectional RPC, and NATS-style events

- Updated dependencies [[`8d5a332`](https://github.com/sidebandtech/sideband/commit/8d5a332c431de165450018512aa0530dbe118f90)]:
  - @sideband/protocol@0.0.8
  - @sideband/rpc@0.0.6
  - @sideband/runtime@0.1.1
  - @sideband/transport@0.0.6
  - @sideband/transport-ws@0.0.1
  - @sideband/secure-relay@0.2.2

## 0.0.1

### Patch Changes

- [#15](https://github.com/sidebandtech/sideband/pull/15) [`38d05a0`](https://github.com/sidebandtech/sideband/commit/38d05a0a10fca560167bec8ad6d6def501aa033d) Thanks [@koistya](https://github.com/koistya)! - Add `@sideband/secure-relay` package with Sideband Relay Protocol (SBRP) implementation: X25519 key exchange, ChaCha20-Poly1305 encryption, and replay protection.

  Change license from MIT to Apache 2.0.
