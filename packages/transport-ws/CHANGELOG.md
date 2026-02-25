# @sideband/transport-ws

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
