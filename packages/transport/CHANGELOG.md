# @sideband/transport

## 0.5.0

### Minor Changes

- [#35](https://github.com/sidebandtech/sideband/pull/35) [`307e7d9`](https://github.com/sidebandtech/sideband/commit/307e7d94b8354bfe351f98f8efe3e649fb392a84) Thanks [@koistya](https://github.com/koistya)! - Make `daemonId` optional in `listen()` — extracted from the presence token's `did` claim automatically; mismatch with a provided value throws immediately.

  Add `AbortSignal` support to `fetchRelaySession` and `renewPresenceToken`.

  Export `CloudApiError` from the main entry point.

  Fix SBRP application-level Ping/Pong handling, `close()` now awaits full loop drain, and add jitter + backoff credit for stable connections.

### Patch Changes

- Updated dependencies [[`307e7d9`](https://github.com/sidebandtech/sideband/commit/307e7d94b8354bfe351f98f8efe3e649fb392a84)]:
  - @sideband/protocol@0.5.0

## 0.4.0

### Minor Changes

- [#32](https://github.com/sidebandtech/sideband/pull/32) [`081a216`](https://github.com/sidebandtech/sideband/commit/081a2163cad5d446dbefb450c2945a6a2ca54884) Thanks [@koistya](https://github.com/koistya)! - Add `@sideband/cloud` package for relay.sideband.cloud integration with `connect()` and `listen()` APIs; extend SBRP negotiator with session token support and dynamic connection params; update transport and runtime types accordingly

### Patch Changes

- Updated dependencies [[`081a216`](https://github.com/sidebandtech/sideband/commit/081a2163cad5d446dbefb450c2945a6a2ca54884)]:
  - @sideband/protocol@0.4.0

## 0.0.7

### Patch Changes

- Updated dependencies [[`5e51e83`](https://github.com/sidebandtech/sideband/commit/5e51e83f660c4b2132304ac8994033669458d610)]:
  - @sideband/protocol@0.0.9

## 0.0.6

### Patch Changes

- [#19](https://github.com/sidebandtech/sideband/pull/19) [`8d5a332`](https://github.com/sidebandtech/sideband/commit/8d5a332c431de165450018512aa0530dbe118f90) Thanks [@koistya](https://github.com/koistya)! - Implement peer SDK with lifecycle state machine, bidirectional RPC, and NATS-style events

- Updated dependencies [[`8d5a332`](https://github.com/sidebandtech/sideband/commit/8d5a332c431de165450018512aa0530dbe118f90)]:
  - @sideband/protocol@0.0.8

## 0.0.5

### Patch Changes

- Updated dependencies [[`256cd7c`](https://github.com/sidebandtech/sideband/commit/256cd7c054611b89ab3139b7e8d0c78b450e27ef)]:
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
