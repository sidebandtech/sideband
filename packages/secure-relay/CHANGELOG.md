# @sideband/secure-relay

## 0.2.3

### Patch Changes

- [#21](https://github.com/sidebandtech/sideband/pull/21) [`c23e3aa`](https://github.com/sidebandtech/sideband/commit/c23e3aacb0cbb45ce95d11a4dbba95cd86a630b3) Thanks [@koistya](https://github.com/koistya)! - Add SBRP E2EE negotiators and `@sideband/peer/sbrp` subpath export

  `@sideband/peer` gains `sbrpClientNegotiator` and `sbrpDaemonNegotiator` via a new
  `@sideband/peer/sbrp` entry point (requires `@sideband/secure-relay` as a peer dep).
  Includes TOFU identity pinning, configurable trust policies (`auto`/`prompt`/`strict`),
  ephemeral key zeroization, and an encrypted channel wrapper with injected crypto ops.

  `@sideband/secure-relay` updates the SBRP handshake wire format: `HandshakeAccept`
  payload grows to 128 bytes and now includes the daemon's Ed25519 identity public key
  inline, removing the need for a separate identity-key frame.

## 0.2.2

### Patch Changes

- [#19](https://github.com/sidebandtech/sideband/pull/19) [`8d5a332`](https://github.com/sidebandtech/sideband/commit/8d5a332c431de165450018512aa0530dbe118f90) Thanks [@koistya](https://github.com/koistya)! - Implement peer SDK with lifecycle state machine, bidirectional RPC, and NATS-style events

## 0.2.1

### Patch Changes

- [#17](https://github.com/sidebandtech/sideband/pull/17) [`256cd7c`](https://github.com/sidebandtech/sideband/commit/256cd7c054611b89ab3139b7e8d0c78b450e27ef) Thanks [@koistya](https://github.com/koistya)! - Add SessionManager, Router, and SbpNegotiator to `@sideband/runtime`.

  **SessionManager** manages connection lifecycle (idle → connecting → negotiating → active → retryWait) with automatic reconnection, configurable backoff, and pluggable negotiators. Includes `onDecodeError` hook for encrypted channels where decode failures indicate crypto issues.

  **Router** handles subject-based message dispatch with validation (`rpc/`, `event/`, `stream/`, `app/` prefixes), handler registration with priority ordering, and built-in RPC envelope processing.

  **SbpNegotiator** implements SBP handshake with configurable timeouts and capability exchange.

  ```ts
  const session = createSessionManager({
    endpoint: "wss://relay.example.com",
    transportFactory: (url) => connectWebSocket(url),
    negotiator: new SbpNegotiator({ localPeerId, capabilities }),
  });

  const router = createRouter();
  router.route("rpc/echo", async (msg, ctx) => ctx.reply({ echo: msg.data }));
  ```

## 0.2.0

### Minor Changes

- [#15](https://github.com/sidebandtech/sideband/pull/15) [`38d05a0`](https://github.com/sidebandtech/sideband/commit/38d05a0a10fca560167bec8ad6d6def501aa033d) Thanks [@koistya](https://github.com/koistya)! - Add `@sideband/secure-relay` package with Sideband Relay Protocol (SBRP) implementation: X25519 key exchange, ChaCha20-Poly1305 encryption, and replay protection.

  Change license from MIT to Apache 2.0.

## 0.1.0

### Minor Changes

- [#13](https://github.com/sidebandtech/sideband/pull/13) [`6cbe425`](https://github.com/sidebandtech/sideband/commit/6cbe425753b3d50f96058daa0c7e55e27cda65c1) Thanks [@koistya](https://github.com/koistya)! - Add secure relay protocol (SRP) package with E2EE handshake, session encryption, and replay protection
