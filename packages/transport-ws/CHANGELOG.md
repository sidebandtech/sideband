# @sideband/transport-ws

## 0.5.0

### Minor Changes

- [#35](https://github.com/sidebandtech/sideband/pull/35) [`307e7d9`](https://github.com/sidebandtech/sideband/commit/307e7d94b8354bfe351f98f8efe3e649fb392a84) Thanks [@koistya](https://github.com/koistya)! - Make `daemonId` optional in `listen()` — extracted from the presence token's `did` claim automatically; mismatch with a provided value throws immediately.

  Add `AbortSignal` support to `fetchRelaySession` and `renewPresenceToken`.

  Export `CloudApiError` from the main entry point.

  Fix SBRP application-level Ping/Pong handling, `close()` now awaits full loop drain, and add jitter + backoff credit for stable connections.

### Patch Changes

- Updated dependencies [[`307e7d9`](https://github.com/sidebandtech/sideband/commit/307e7d94b8354bfe351f98f8efe3e649fb392a84)]:
  - @sideband/protocol@0.5.0
  - @sideband/transport@0.5.0

## 0.4.0

### Minor Changes

- [#32](https://github.com/sidebandtech/sideband/pull/32) [`081a216`](https://github.com/sidebandtech/sideband/commit/081a2163cad5d446dbefb450c2945a6a2ca54884) Thanks [@koistya](https://github.com/koistya)! - Add `@sideband/cloud` package for relay.sideband.cloud integration with `connect()` and `listen()` APIs; extend SBRP negotiator with session token support and dynamic connection params; update transport and runtime types accordingly

### Patch Changes

- Updated dependencies [[`081a216`](https://github.com/sidebandtech/sideband/commit/081a2163cad5d446dbefb450c2945a6a2ca54884)]:
  - @sideband/protocol@0.4.0
  - @sideband/transport@0.4.0

## 0.0.4

### Patch Changes

- [#28](https://github.com/sidebandtech/sideband/pull/28) [`d232d0d`](https://github.com/sidebandtech/sideband/commit/d232d0de059dfd8d5b3c44f1d21d245d61f85a2e) Thanks [@koistya](https://github.com/koistya)! - Fix iterator lock not released on early `for await` exit

  Adds `iterator.return()` to `WsConnection.inbound` so that breaking out of a
  `for await...of` loop (e.g. after reading the negotiation frame) clears
  `_iteratorActive`, allowing a second consumer to be created without throwing
  "iterator already consumed". Also sets the flag in the fast-path close handler.

  Removes the `"node"` condition from the root `.` export so the subpath
  `@sideband/transport-ws/node` is the canonical Node.js entry point; updates
  `@sideband/peer` to import from that subpath accordingly.

## 0.0.2

### Patch Changes

- [#25](https://github.com/sidebandtech/sideband/pull/25) [`5e51e83`](https://github.com/sidebandtech/sideband/commit/5e51e83f660c4b2132304ac8994033669458d610) Thanks [@koistya](https://github.com/koistya)! - Add `wsTransport` to browser entry point so bundlers targeting browser can import the unified factory from the root package path.

  Previously, the `"browser"` export condition for `.` resolved to `browser.js`, which exported `browserWsTransport` and utilities but omitted `wsTransport`. Any browser-target bundle that imported `wsTransport` from `@sideband/transport-ws` (e.g. via `@sideband/peer`) would fail with a missing-export error.

  `wsTransport` in the browser context always delegates to `browserWsTransport()`; the `platform` option is accepted for API parity but ignored.

- Updated dependencies [[`5e51e83`](https://github.com/sidebandtech/sideband/commit/5e51e83f660c4b2132304ac8994033669458d610)]:
  - @sideband/protocol@0.0.9
  - @sideband/transport@0.0.7

## 0.0.1

### Patch Changes

- [#19](https://github.com/sidebandtech/sideband/pull/19) [`8d5a332`](https://github.com/sidebandtech/sideband/commit/8d5a332c431de165450018512aa0530dbe118f90) Thanks [@koistya](https://github.com/koistya)! - Implement peer SDK with lifecycle state machine, bidirectional RPC, and NATS-style events

- Updated dependencies [[`8d5a332`](https://github.com/sidebandtech/sideband/commit/8d5a332c431de165450018512aa0530dbe118f90)]:
  - @sideband/protocol@0.0.8
  - @sideband/transport@0.0.6
