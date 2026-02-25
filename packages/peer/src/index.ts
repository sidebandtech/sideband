// SPDX-License-Identifier: Apache-2.0

/**
 * @sideband/peer — high-level peer SDK
 *
 * Primary API surface:
 *   - `createPeer(options)` — client-side peer with lifecycle, RPC, events
 *   - `listen(options)` — server-side listener yielding `AcceptedPeer` instances
 *   - `sbpNegotiator(options?)` — plain SBP negotiator for direct connections
 *
 * @example Basic local connection
 * ```ts
 * import { createPeer } from "@sideband/peer";
 *
 * const peer = createPeer({ endpoint: "ws://localhost:8080" });
 * await peer.connect();
 *
 * const api = peer.rpc.client<{ "echo": (p: { msg: string }) => string }>();
 * const result = await api["echo"]({ msg: "hello" });
 * ```
 *
 * @example Server side
 * ```ts
 * import { listen } from "@sideband/peer";
 *
 * const server = await listen({
 *   endpoint: "ws://localhost:8080",
 *   onConnection(peer) {
 *     peer.rpc.handle<{ msg: string }, string>("echo", (p) => p.msg);
 *   },
 * });
 * ```
 */

// Factories
export { listen } from "./listen.js";
export { createPeer, sbpNegotiator } from "./peer.js";

// SBRP negotiators available via "@sideband/peer/sbrp" subpath
// (requires @sideband/secure-relay as a peer dependency)

// Error types
export { PeerError, PeerErrorCode, RpcPeerError } from "./errors.js";
export type { PeerErrorCode as PeerErrorCodeType } from "./errors.js";

// Pattern utilities (for advanced use)
export { isValidEventName, matchPattern, validatePattern } from "./pattern.js";

// Public types
export type {
  AcceptedPeer,
  ConnectionPolicy,
  EventPolicy,
  EventsInterface,
  ListenOptions,
  PatternSubscription,
  Peer,
  PeerEvents,
  PeerOptions,
  PeerServer,
  PeerState,
  ReconnectionOutcome,
  RetryPolicy,
  RpcCallOptions,
  RpcInterface,
  RpcPolicy,
  TryCallResult,
  TypedRpcClient,
  Unsubscribe,
} from "./types.js";
