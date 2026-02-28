// SPDX-License-Identifier: Apache-2.0

/**
 * Cloud client — connects to a daemon via relay.sideband.cloud.
 *
 * `connect()` returns a `Peer` that automatically:
 * - Fetches a fresh relay session on each connect attempt (new sessionId every
 *   time, preventing ghost-socket 409 collisions on the relay)
 * - Passes the session token directly to `sbrpClientNegotiator` (no manual
 *   JWT decoding needed)
 * - Retries with backoff per `retryPolicy`
 */

import { createPeer, PeerError, PeerErrorCode } from "@sideband/peer";
import type {
  ConnectionPolicy,
  EventPolicy,
  Peer,
  RetryPolicy,
  RpcPolicy,
} from "@sideband/peer";
import { classifySbrpError, sbrpClientNegotiator } from "@sideband/peer/sbrp";
import type { IdentityKeyStore } from "@sideband/peer/sbrp";
import type { TransportConnection } from "@sideband/transport";
import { asDaemonId } from "@sideband/secure-relay";
import { classifyApiError, CloudApiError, fetchRelaySession } from "./api.js";

interface ConnectOptionsBase {
  /** Daemon to connect to (e.g. `"d_abc123"`). */
  daemonId: string;
  /**
   * Returns the user's current access token for api.sideband.cloud.
   * Called on each connect attempt — tokens may rotate. The sync form is
   * fine for long-lived tokens.
   *
   * Note: the SDK does not refresh expired user tokens. If `getAccessToken()`
   * consistently returns an invalid token, the peer retries until
   * `retryPolicy.maxAttempts` is exhausted. Ensure tokens are valid before
   * passing them. If the promise never resolves, `peer.connect()` will stall
   * indefinitely — guard against hanging auth providers on your end.
   */
  getAccessToken: () => string | Promise<string>;
  /** TOFU identity key store for daemon fingerprint pinning. */
  identityKeyStore: IdentityKeyStore;
  /** Defaults to `"https://api.sideband.cloud"`. */
  apiUrl?: string;
  connectionPolicy?: Partial<ConnectionPolicy>;
  rpcPolicy?: Partial<RpcPolicy>;
  eventPolicy?: Partial<EventPolicy>;
  retryPolicy?: Partial<RetryPolicy>;
  /**
   * Called for unhandled runtime errors (via `@sideband/peer`) and for
   * terminal connection failures. Terminal failures surface as `CloudApiError`
   * (fatal credentials) or `PeerError` (retries exhausted); when omitted,
   * terminal failures fall back to `console.error`. Runtime error handling
   * when omitted follows `@sideband/peer`'s default.
   */
  onUnhandledError?: (error: Error) => void;
}

/**
 * Options for {@link connect}.
 *
 * Trust policy is a discriminated union — when `trustPolicy` is `"prompt"`,
 * both `onFirstConnection` and `onIdentityMismatch` are required at the type
 * level (matching `SbrpClientOptions`). For `"auto"` or `"strict"` (the
 * default is `"auto"` in the cloud context) both callbacks are optional.
 */
export type ConnectOptions =
  | (ConnectOptionsBase & {
      /**
       * TOFU trust policy. Defaults to `"auto"` in the cloud context because
       * the control plane has already authenticated the daemon via API key at
       * registration time.
       *
       * ⚠ `"auto"` weakens TOFU guarantees: it silently re-pins on identity
       * mismatch, making it TOFR (Trust On First Registration) rather than
       * strict TOFU. Use `"prompt"` or `"strict"` for higher-assurance scenarios.
       */
      trustPolicy?: "auto" | "strict";
      onFirstConnection?: (info: { fingerprint: string }) => Promise<boolean>;
      onIdentityMismatch?: (info: {
        expectedFingerprint: string;
        receivedFingerprint: string;
      }) => Promise<boolean>;
    })
  | (ConnectOptionsBase & {
      /** Prompt the user on first connect and on identity mismatch. */
      trustPolicy: "prompt";
      /** Called on first connection. Must return `true` to accept. */
      onFirstConnection: (info: { fingerprint: string }) => Promise<boolean>;
      /** Called when the pinned key doesn't match. Must return `true` to accept. */
      onIdentityMismatch: (info: {
        expectedFingerprint: string;
        receivedFingerprint: string;
      }) => Promise<boolean>;
    });

/**
 * Connect to a daemon via relay.sideband.cloud.
 *
 * Creates a cloud-connected `Peer` and starts connecting immediately.
 * Register handlers (e.g. `peer.rpc.handle(...)`) before awaiting
 * `peer.whenReady()`.
 *
 * Defaults differ from low-level `createPeer()`:
 * - `connectionPolicy.onDisconnect` defaults to `"pause"` (buffer RPCs across reconnects)
 * - `retryPolicy.mode` defaults to `"on-error"` (auto-reconnect on transport drops)
 * User-provided values take precedence.
 *
 * @example
 * ```ts
 * const peer = connect({
 *   daemonId: "d_abc123",
 *   getAccessToken: () => auth.getSessionToken(),
 *   identityKeyStore: store,
 * });
 * peer.rpc.handle("push", handlePush);
 * await peer.whenReady();
 * const result = await peer.rpc.call("ping");
 * ```
 */
export function connect(opts: ConnectOptions): Peer {
  const peer = createPeer({
    negotiator: new CloudClientNegotiator(opts),
    // Cloud-appropriate defaults: buffer across reconnects, auto-reconnect.
    // User overrides take precedence via spread order.
    connectionPolicy: { onDisconnect: "pause", ...opts.connectionPolicy },
    retryPolicy: { mode: "on-error", ...opts.retryPolicy },
    rpcPolicy: opts.rpcPolicy,
    eventPolicy: opts.eventPolicy,
    onUnhandledError: opts.onUnhandledError,
  });
  // Fire-and-forget: peer.connect() rejects only on terminal failures
  // (fatal credential error, or retries exhausted). The peer wraps these as
  // PeerError(peer_closed, { cause }). Unwrap fatal CloudApiErrors (400/401/403/404)
  // so credential failures surface the same way they do from listen() — both
  // expose CloudApiError directly. Retryable errors that became terminal via
  // maxAttempts keep the PeerError wrapper (terminality came from retry policy,
  // not the error itself — the wrapper adds meaningful context in that case).
  peer.connect().catch((err) => {
    const error = err instanceof Error ? err : new Error(String(err));
    const unwrapped =
      error instanceof PeerError &&
      error.cause instanceof CloudApiError &&
      classifyApiError(error.cause) === "fatal"
        ? error.cause
        : error;
    (opts.onUnhandledError ?? console.error)(unwrapped);
  });
  return peer;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal negotiator for cloud client connections.
 *
 * `getConnectionParams()` fetches a fresh relay session on every attempt:
 * a new sessionId per connection (required by relay — reuse causes 409).
 * The session token is passed directly to `sbrpClientNegotiator` which
 * extracts the sessionId from the JWT `sid` claim.
 */
class CloudClientNegotiator {
  // Session token for the current connection attempt — set by
  // getConnectionParams(), consumed by negotiate(). Overwritten on each attempt
  // so reconnects always use a fresh session (relay rejects reused sessionIds).
  // Peer guarantees sequential getConnectionParams/negotiate pairs (never
  // concurrent), so this field is not subject to data races.
  private currentSessionToken: string | null = null;

  constructor(private readonly opts: ConnectOptions) {}

  async getConnectionParams() {
    // Clear before awaiting so a stale token is never used if this throws.
    this.currentSessionToken = null;
    const accessToken = await this.opts.getAccessToken();
    // Always fetch a new session — relay rejects reused sessionIds (409 conflict)
    const session = await fetchRelaySession(
      this.opts.daemonId,
      accessToken,
      this.opts.apiUrl,
    );
    const url = new URL(session.relayUrl);
    url.searchParams.set("token", session.token);
    this.currentSessionToken = session.token;
    return { endpoint: url.toString() };
  }

  async negotiate(transport: TransportConnection) {
    // Extract to local consts — TypeScript narrows local const variables
    // reliably; class properties can't be narrowed across async boundaries.
    const sessionToken = this.currentSessionToken;
    if (!sessionToken) {
      // getConnectionParams() always runs before negotiate() in the Peer
      // connection loop. This guard protects against external misuse.
      throw new PeerError(
        PeerErrorCode.InvalidState,
        "CloudClientNegotiator: session not initialized — getConnectionParams() must run first",
      );
    }
    const { opts } = this;
    // Split on the trustPolicy discriminant so each arm is fully type-safe
    // against SbrpClientOptions — no assertion casts needed.
    const inner =
      opts.trustPolicy === "prompt"
        ? sbrpClientNegotiator({
            daemonId: asDaemonId(opts.daemonId),
            sessionToken,
            identityKeyStore: opts.identityKeyStore,
            trustPolicy: "prompt",
            onFirstConnection: opts.onFirstConnection,
            onIdentityMismatch: opts.onIdentityMismatch,
          })
        : sbrpClientNegotiator({
            daemonId: asDaemonId(opts.daemonId),
            sessionToken,
            identityKeyStore: opts.identityKeyStore,
            trustPolicy: opts.trustPolicy ?? "auto",
            onFirstConnection: opts.onFirstConnection,
            onIdentityMismatch: opts.onIdentityMismatch,
          });
    return inner.negotiate(transport);
  }

  async terminate(transport: TransportConnection): Promise<void> {
    try {
      await transport.close();
    } catch {
      // Ignore termination errors
    }
  }

  classifyError(error: Error): "fatal" | "retryable" {
    // API errors from getConnectionParams() — classify by HTTP status before
    // falling through to SBRP error classification.
    if (error instanceof CloudApiError) return classifyApiError(error);
    return classifySbrpError(error);
  }
}
