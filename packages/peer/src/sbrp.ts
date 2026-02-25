// SPDX-License-Identifier: Apache-2.0

/**
 * @sideband/peer/sbrp — SBRP (E2EE relay) negotiators
 *
 * Requires `@sideband/secure-relay` as a peer dependency.
 * Import from this subpath only when using encrypted relay connections.
 *
 * @example
 * ```ts
 * import { sbrpClientNegotiator, createMemoryIdentityKeyStore } from "@sideband/peer/sbrp";
 * import { createPeer } from "@sideband/peer";
 *
 * const negotiator = sbrpClientNegotiator({
 *   daemonId: asDaemonId("my-daemon"),
 *   sessionId: 1n,
 *   identityKeyStore: createMemoryIdentityKeyStore(),
 *   trustPolicy: "auto",
 * });
 *
 * const peer = createPeer({ endpoint: "wss://relay.example.com", negotiator });
 * ```
 */

export {
  createMemoryIdentityKeyStore,
  createSbrpChannel,
  sbrpClientNegotiator,
  sbrpDaemonNegotiator,
} from "./negotiator/index.js";
export type {
  ChannelCrypto,
  IdentityKeyStore,
  SbrpClientOptions,
  SbrpDaemonOptions,
  TrustPolicy,
} from "./negotiator/index.js";
