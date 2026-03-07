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
export type TrustPolicy = "auto" | "prompt" | "pinned-only";

/**
 * Session source for `relayClientNegotiator`.
 *
 * - `sessionToken`: relay mode — provide the JWT directly; `sessionId` is
 *   extracted from the `sid` claim automatically (base64url → uint64).
 * - `sessionId`: direct / self-hosted mode — provide the uint64 explicitly.
 */
type SbrpClientSessionSource =
  | { sessionToken: string; sessionId?: never }
  | { sessionId: bigint; sessionToken?: never };

type SbrpClientSharedOptions = SbrpClientSessionSource & {
  daemonId: DaemonId;
  identityKeyStore: IdentityKeyStore;
  handshakeTimeoutMs?: number;
  /** Local peer ID for inner SBP handshake. Auto-generated if omitted. */
  peerId?: string;
  capabilities?: string[];
};

type FirstConnectionPrompt = (info: {
  fingerprint: string;
}) => Promise<boolean>;

type IdentityMismatchHandler = (info: {
  expectedFingerprint: string;
  receivedFingerprint: string;
}) => Promise<boolean>;

/**
 * Options for `relayClientNegotiator()`.
 *
 * `trustPolicy` controls TOFU behavior:
 * - `"auto"`: accept on first connection, verify on reconnect
 * - `"prompt"`: call `onFirstConnection`/`onIdentityMismatch` (default)
 * - `"pinned-only"`: reject if no pinned key exists or if key changed
 *
 * If `trustPolicy` is omitted, it defaults to `"prompt"` and both
 * `onFirstConnection` and `onIdentityMismatch` are required.
 */
export type SbrpClientOptions =
  | (SbrpClientSharedOptions & {
      trustPolicy?: "prompt";
      /** Called on first connection. Must return `true` to accept. */
      onFirstConnection: FirstConnectionPrompt;
      /** Called when pinned key doesn't match wire key. Must return `true` to accept. */
      onIdentityMismatch: IdentityMismatchHandler;
    })
  | (SbrpClientSharedOptions & {
      trustPolicy: "auto" | "pinned-only";
      onFirstConnection?: FirstConnectionPrompt;
      onIdentityMismatch?: IdentityMismatchHandler;
    });

/** Options for `relayDaemonNegotiator()`. */
export interface SbrpDaemonOptions {
  daemonId: DaemonId;
  identityKeyPair: IdentityKeyPair;
  handshakeTimeoutMs?: number;
  /** Local peer ID for inner SBP handshake. Auto-generated if omitted. */
  peerId?: string;
  capabilities?: string[];
}
