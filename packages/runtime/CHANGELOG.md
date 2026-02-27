# @sideband/runtime

## 0.4.0

### Minor Changes

- [#32](https://github.com/sidebandtech/sideband/pull/32) [`081a216`](https://github.com/sidebandtech/sideband/commit/081a2163cad5d446dbefb450c2945a6a2ca54884) Thanks [@koistya](https://github.com/koistya)! - Add `@sideband/cloud` package for relay.sideband.cloud integration with `connect()` and `listen()` APIs; extend SBRP negotiator with session token support and dynamic connection params; update transport and runtime types accordingly

### Patch Changes

- Updated dependencies [[`081a216`](https://github.com/sidebandtech/sideband/commit/081a2163cad5d446dbefb450c2945a6a2ca54884)]:
  - @sideband/protocol@0.4.0
  - @sideband/rpc@0.4.0
  - @sideband/transport@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`5e51e83`](https://github.com/sidebandtech/sideband/commit/5e51e83f660c4b2132304ac8994033669458d610)]:
  - @sideband/protocol@0.0.9
  - @sideband/rpc@0.0.7
  - @sideband/transport@0.0.7

## 0.2.0

### Minor Changes

- [#23](https://github.com/sidebandtech/sideband/pull/23) [`0eece18`](https://github.com/sidebandtech/sideband/commit/0eece1817a93028659548a7cc2580e29621af8bb) Thanks [@koistya](https://github.com/koistya)! - Add session signal handling and split `listen()` into `@sideband/peer/server`.

  **Breaking:** `listen()` is no longer exported from `@sideband/peer`. Import it from the new `@sideband/peer/server` subpath instead:

  ```ts
  // Before
  import { listen } from "@sideband/peer";

  // After
  import { listen } from "@sideband/peer/server";
  ```

  **New (`@sideband/peer`):** SBRP relay pause/resume signals are now propagated to the Peer SDK. `"paused"` is a first-class `PeerState`; `sessionPaused` and `sessionResumed` events fire on relay transitions. During `"paused"`: `sendRaw()` rejects with `PeerError("session_paused")`; events buffer and flush on resume; RPC calls reject or buffer per `connectionPolicy.onDisconnect`.

  **New (`@sideband/runtime`):** `SessionSignal` type and optional `subscribeSignals` on `NegotiationResult`. Negotiators that return `subscribeSignals` can push relay control signals into the SDK without coupling the runtime to SBRP internals.

## 0.1.1

### Patch Changes

- [#19](https://github.com/sidebandtech/sideband/pull/19) [`8d5a332`](https://github.com/sidebandtech/sideband/commit/8d5a332c431de165450018512aa0530dbe118f90) Thanks [@koistya](https://github.com/koistya)! - Implement peer SDK with lifecycle state machine, bidirectional RPC, and NATS-style events

- Updated dependencies [[`8d5a332`](https://github.com/sidebandtech/sideband/commit/8d5a332c431de165450018512aa0530dbe118f90)]:
  - @sideband/protocol@0.0.8
  - @sideband/rpc@0.0.6
  - @sideband/transport@0.0.6

## 0.1.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`256cd7c`](https://github.com/sidebandtech/sideband/commit/256cd7c054611b89ab3139b7e8d0c78b450e27ef)]:
  - @sideband/rpc@0.0.5
  - @sideband/protocol@0.0.7

## 0.0.4

### Patch Changes

- [#15](https://github.com/sidebandtech/sideband/pull/15) [`38d05a0`](https://github.com/sidebandtech/sideband/commit/38d05a0a10fca560167bec8ad6d6def501aa033d) Thanks [@koistya](https://github.com/koistya)! - Add `@sideband/secure-relay` package with Sideband Relay Protocol (SBRP) implementation: X25519 key exchange, ChaCha20-Poly1305 encryption, and replay protection.

  Change license from MIT to Apache 2.0.

- Updated dependencies [[`38d05a0`](https://github.com/sidebandtech/sideband/commit/38d05a0a10fca560167bec8ad6d6def501aa033d)]:
  - @sideband/protocol@0.0.6

## 0.0.3

### Patch Changes

- [#9](https://github.com/sidebandtech/sideband/pull/9) [`8f50835`](https://github.com/sidebandtech/sideband/commit/8f508352ba84e7121f5918cffdc89deda97d55d8) Thanks [@koistya](https://github.com/koistya)! - Configure automatic version bump and publishing to NPM
