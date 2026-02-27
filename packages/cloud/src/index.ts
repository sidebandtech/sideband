// SPDX-License-Identifier: Apache-2.0

/**
 * @sideband/cloud — high-level SDK for relay.sideband.cloud
 *
 * Entry points:
 *   - `connect(opts)` — client: connect to a daemon via the cloud relay
 *   - `listen(opts)` — daemon: accept client sessions via the cloud relay
 *
 * Both handle token management automatically:
 *   - `connect()` fetches a fresh relay session on every connect attempt
 *   - `listen()` renews the presence token on every relay reconnect
 *
 * @example Client
 * ```ts
 * import { connect, createMemoryIdentityKeyStore } from "@sideband/cloud";
 *
 * const peer = connect({
 *   daemonId: "d_abc123",
 *   getAccessToken: () => auth.getSessionToken(),
 *   identityKeyStore: createMemoryIdentityKeyStore(),
 * });
 * peer.rpc.handle("push", handlePush);
 * await peer.whenReady();
 * ```
 *
 * @example Daemon
 * ```ts
 * import { listen, generateIdentityKeyPair } from "@sideband/cloud";
 *
 * const server = await listen({
 *   daemonId: process.env.SIDEBAND_DAEMON_ID,
 *   apiKey: process.env.SIDEBAND_API_KEY,
 *   identityKeyPair: await loadOrCreateIdentityKeyPair(),
 *   onConnection(peer) {
 *     peer.rpc.handle("ping", () => "pong");
 *   },
 * });
 * ```
 */

export { connect } from "./connect.js";
export type { ConnectOptions } from "./connect.js";
export { listen } from "./listen.js";
export type { ListenOptions } from "./listen.js";

// Convenience re-exports so callers don't need to import from @sideband/peer directly
export { PeerError, PeerErrorCode } from "@sideband/peer";
export type { AcceptedPeer, Peer, PeerServer, PeerState } from "@sideband/peer";
export { createMemoryIdentityKeyStore } from "@sideband/peer/sbrp";
export type { IdentityKeyStore } from "@sideband/peer/sbrp";

// Key management helpers for daemon identity
export { generateIdentityKeyPair } from "@sideband/secure-relay";
export type { IdentityKeyPair } from "@sideband/secure-relay";
