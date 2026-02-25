// SPDX-License-Identifier: Apache-2.0

import type { DaemonId, IdentityKeyPair } from "@sideband/secure-relay";

/**
 * Persistent storage for TOFU-pinned daemon identity keys.
 *
 * Implementations: `createMemoryIdentityKeyStore()` (test/dev),
 * future: localStorage, file-based.
 */
export interface IdentityKeyStore {
  get(daemonId: DaemonId): Promise<Uint8Array | null>;
  set(daemonId: DaemonId, publicKey: Uint8Array): Promise<void>;
  delete(daemonId: DaemonId): Promise<void>;
  list(): Promise<DaemonId[]>;
}

/** Trust policy for first-connection and reconnection identity verification. */
export type TrustPolicy = "auto" | "prompt" | "strict";

interface SbrpClientSharedOptions {
  daemonId: DaemonId;
  /** Relay-assigned session ID (from JWT `sid` claim). */
  sessionId: bigint;
  identityKeyStore: IdentityKeyStore;
  /** Called when pinned key doesn't match wire key. Must return `true` to accept the new key. */
  onIdentityMismatch?: (info: {
    expectedFingerprint: string;
    receivedFingerprint: string;
  }) => Promise<boolean>;
  handshakeTimeoutMs?: number;
  /** Local peer ID for inner SBP handshake. Auto-generated if omitted. */
  peerId?: string;
  capabilities?: string[];
}

type FirstConnectionPrompt = (info: {
  fingerprint: string;
}) => Promise<boolean>;

/**
 * Options for `sbrpClientNegotiator()`.
 *
 * `trustPolicy` controls TOFU behavior:
 * - `"auto"`: accept on first connection, verify on reconnect
 * - `"prompt"`: call `onFirstConnection` on first connection (default)
 * - `"strict"`: reject if no pinned key exists
 *
 * If `trustPolicy` is omitted, it defaults to `"prompt"` and
 * `onFirstConnection` is required.
 */
export type SbrpClientOptions =
  | (SbrpClientSharedOptions & {
      trustPolicy?: "prompt";
      /** Called on first connection when `trustPolicy` is `"prompt"`. Must return `true` to accept. */
      onFirstConnection: FirstConnectionPrompt;
    })
  | (SbrpClientSharedOptions & {
      trustPolicy: "auto" | "strict";
      onFirstConnection?: FirstConnectionPrompt;
    });

/** Options for `sbrpDaemonNegotiator()`. */
export interface SbrpDaemonOptions {
  daemonId: DaemonId;
  identityKeyPair: IdentityKeyPair;
  handshakeTimeoutMs?: number;
  /** Local peer ID for inner SBP handshake. Auto-generated if omitted. */
  peerId?: string;
  capabilities?: string[];
}
