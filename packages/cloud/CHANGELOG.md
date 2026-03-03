# @sideband/cloud

## 0.5.2

### Patch Changes

- [#39](https://github.com/sidebandtech/sideband/pull/39) [`660cd2d`](https://github.com/sidebandtech/sideband/commit/660cd2da60f390ac99a4b234382abf08d0f02a62) Thanks [@koistya](https://github.com/koistya)! - Fix `RelayVirtualConn` iterator `return()` leaving a pending `next()` unresolved

## 0.5.1

### Patch Changes

- [#37](https://github.com/sidebandtech/sideband/pull/37) [`39621cd`](https://github.com/sidebandtech/sideband/commit/39621cdcdc0e7f2a6b02e403b43a5a12786f284d) Thanks [@koistya](https://github.com/koistya)! - Fix tRPC response parsing — correct `TrpcResponse<T>` envelope shape (`data: T` not `data: { json: T }`, `error.message`/`error.data.code` not `error.json`).

## 0.5.0

### Minor Changes

- [#35](https://github.com/sidebandtech/sideband/pull/35) [`307e7d9`](https://github.com/sidebandtech/sideband/commit/307e7d94b8354bfe351f98f8efe3e649fb392a84) Thanks [@koistya](https://github.com/koistya)! - Make `daemonId` optional in `listen()` — extracted from the presence token's `did` claim automatically; mismatch with a provided value throws immediately.

  Add `AbortSignal` support to `fetchRelaySession` and `renewPresenceToken`.

  Export `CloudApiError` from the main entry point.

  Fix SBRP application-level Ping/Pong handling, `close()` now awaits full loop drain, and add jitter + backoff credit for stable connections.

### Patch Changes

- Updated dependencies [[`307e7d9`](https://github.com/sidebandtech/sideband/commit/307e7d94b8354bfe351f98f8efe3e649fb392a84)]:
  - @sideband/peer@0.5.0
  - @sideband/secure-relay@0.5.0
  - @sideband/transport@0.5.0
  - @sideband/transport-ws@0.5.0

## 0.4.0

### Minor Changes

- [#32](https://github.com/sidebandtech/sideband/pull/32) [`081a216`](https://github.com/sidebandtech/sideband/commit/081a2163cad5d446dbefb450c2945a6a2ca54884) Thanks [@koistya](https://github.com/koistya)! - Add `@sideband/cloud` package for relay.sideband.cloud integration with `connect()` and `listen()` APIs; extend SBRP negotiator with session token support and dynamic connection params; update transport and runtime types accordingly

### Patch Changes

- Updated dependencies [[`081a216`](https://github.com/sidebandtech/sideband/commit/081a2163cad5d446dbefb450c2945a6a2ca54884)]:
  - @sideband/peer@1.0.0
  - @sideband/secure-relay@0.4.0
  - @sideband/transport@0.4.0
  - @sideband/transport-ws@0.4.0
