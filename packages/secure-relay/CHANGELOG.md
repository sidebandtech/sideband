# @sideband/secure-relay

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
