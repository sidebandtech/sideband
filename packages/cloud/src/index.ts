// SPDX-License-Identifier: Apache-2.0

/**
 * @sideband/cloud — high-level SDK for relay.sideband.cloud
 *
 * Entry points:
 *   - `connect(opts)` — client: connect to a daemon via the cloud relay
 *   - `listen(opts)` — daemon: accept client sessions via the cloud relay
 *
 * `connect()` supports two auth modes:
 *   - Account (`{ daemonId, getAccessToken }`) — fetches a fresh relay session
 *     on every connect attempt and reconnects automatically on transient failures.
 *   - Quick Connect (`{ quickConnectCode }`) — one-shot: code is consumed on the
 *     first connect; the peer terminates fatally on disconnect (code is gone).
 *
 * `listen()` renews the presence token on every relay reconnect automatically.
 *
 * @example Account mode — persistent, reconnectable
 * ```ts
 * import { connect, createIndexedDBIdentityKeyStore } from "@sideband/cloud";
 *
 * const peer = connect({
 *   daemonId: "d_abc123",
 *   getAccessToken: () => auth.getSessionToken(),
 *   identityKeyStore: createIndexedDBIdentityKeyStore(),
 * });
 * peer.rpc.handle("push", handlePush);
 * await peer.whenReady();
 * ```
 *
 * @example Quick Connect — one-shot bootstrap (code consumed on connect)
 * ```ts
 * import { connect, createIndexedDBIdentityKeyStore } from "@sideband/cloud";
 *
 * const peer = connect({
 *   quickConnectCode: "abcd-efgh-ijkl",
 *   identityKeyStore: createIndexedDBIdentityKeyStore(),
 * });
 * await peer.whenReady();
 * ```
 *
 * @example Daemon
 * ```ts
 * import { listen, generateIdentityKeyPair } from "@sideband/cloud";
 *
 * // daemonId is optional — extracted from the presence token automatically.
 * const server = await listen({
 *   apiKey: process.env.SIDEBAND_API_KEY,
 *   identityKeyPair: await loadOrCreateIdentityKeyPair(),
 *   onConnection(peer) {
 *     peer.rpc.handle("ping", () => "pong");
 *   },
 * });
 * ```
 */

export { CloudApiError } from "./api.js";
export { connect } from "./connect.js";
export type { ConnectOptions } from "./connect.js";
export { listen } from "./listen.js";
export type { ListenOptions } from "./listen.js";

// Convenience re-exports so callers don't need to import from @sideband/peer directly
export { PeerError, PeerErrorCode } from "@sideband/peer";
export type { AcceptedPeer, Peer, PeerServer, PeerState } from "@sideband/peer";
export { createMemoryIdentityKeyStore } from "@sideband/peer/sbrp";
export type { IdentityKeyStore } from "@sideband/peer/sbrp";
export { createIndexedDBIdentityKeyStore } from "./identity-key-store.js";

// Key management helpers for daemon identity
export { generateIdentityKeyPair } from "@sideband/secure-relay";
export type { IdentityKeyPair } from "@sideband/secure-relay";
