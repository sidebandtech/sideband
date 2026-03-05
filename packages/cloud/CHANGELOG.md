# @sideband/cloud

## 0.5.5

### Patch Changes

- [#48](https://github.com/sidebandtech/sideband/pull/48) [`6be8333`](https://github.com/sidebandtech/sideband/commit/6be8333d20b0614ead1b1e2368d791bd59134050) Thanks [@koistya](https://github.com/koistya)! - Fix tRPC mutation request body: remove incorrect `{ json: input }` wrapper so the API call sends the input directly.

## 0.5.4

### Patch Changes

- [#44](https://github.com/sidebandtech/sideband/pull/44) [`e6f52c4`](https://github.com/sidebandtech/sideband/commit/e6f52c42ebbba7e5649c3fa7c1263d83a53cc32a) Thanks [@koistya](https://github.com/koistya)! - `listen()` now returns `CloudPeerServer` with Quick Connect support

  `listen()` resolves to a `CloudPeerServer` (extends `PeerServer`) that exposes
  `daemonId`, `relayUrl`, and `createQuickConnect()` — eliminating the need to
  track these values separately.

  ```ts
  const server = await listen({ apiKey, identityKeyPair, onConnection });
  // server.daemonId    — daemon ID from the presence token
  // server.relayUrl    — relay WebSocket base URL
  const qc = await server.createQuickConnect({ ttlSeconds: 300 });
  // qc.code, qc.url, qc.expiresAt
  ```

  Also exports `renewPresenceToken`, `extractDaemonIdFromToken`, and
  `CloudPeerServer` from the package root, and adds a 15 s hard timeout to all
  API calls to prevent hung connections.

## 0.5.3

### Patch Changes

- [#43](https://github.com/sidebandtech/sideband/pull/43) [`b405ad1`](https://github.com/sidebandtech/sideband/commit/b405ad1a28924d9de1e3dd1c99e0745041b91407) Thanks [@koistya](https://github.com/koistya)! - Add `createIndexedDBIdentityKeyStore()` for browser-persistent TOFU pins

  Browser-backed `IdentityKeyStore` that persists daemon identity keys in
  IndexedDB across page reloads. Lazy-initialized (safe to import in Node),
  auto-recovers on `versionchange` or open errors, and defensively copies
  all key material.

- [#41](https://github.com/sidebandtech/sideband/pull/41) [`278417a`](https://github.com/sidebandtech/sideband/commit/278417a658841e606e3142072c5fc90d967c6da6) Thanks [@koistya](https://github.com/koistya)! - Add Quick Connect auth mode to `connect()`

  `connect()` now accepts a `quickConnectCode` option as a one-shot bootstrap
  path. The code is redeemed on the first connect attempt (single-use) and the
  resolved `daemonId` is used for the SBRP handshake. Because the code is
  consumed on use, the peer terminates fatally on disconnect — use the account
  path (`daemonId` + `getAccessToken`) for persistent, reconnectable sessions.

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
