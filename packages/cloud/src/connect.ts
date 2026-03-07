// SPDX-License-Identifier: Apache-2.0

/**
 * Cloud client — connects to a daemon via relay.sideband.cloud.
 *
 * `connect()` supports two auth modes (discriminated at the type level):
 * - Quick Connect: `{ quickConnectCode }` — one-shot bootstrap; code is the
 *   credential and daemonId is resolved from the redeem response. After the
 *   initial connection the session cannot be re-established (QC codes are
 *   single-use). Use the account path for persistent, reconnectable sessions.
 * - Account: `{ daemonId, getAccessToken }` — standard user access token path;
 *   reconnects automatically on transient failures.
 */

import { createPeer, PeerError, PeerErrorCode } from "@sideband/peer";
import type {
  ConnectionPolicy,
  EventPolicy,
  Peer,
  RetryPolicy,
  RpcPolicy,
} from "@sideband/peer";
import { classifySbrpError, relayClientNegotiator } from "@sideband/peer/sbrp";
import type { IdentityKeyStore } from "@sideband/peer/sbrp";
import type { TransportConnection } from "@sideband/transport";
import { asDaemonId } from "@sideband/secure-relay";
import {
  classifyApiError,
  CloudApiError,
  fetchRelaySession,
  redeemQuickConnectCode,
} from "./api.js";

interface ConnectOptionsCommon {
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
 * Quick Connect path — the code is the credential; daemonId is resolved from
 * the redeem response. Both `daemonId` and `getAccessToken` are forbidden
 * (type-level `never`) — QC is a one-shot bootstrap, not a persistent session.
 *
 * QC codes are single-use: the first `getConnectionParams()` call redeems the
 * code and establishes the session. If the connection later drops, the peer
 * terminates fatally (code is already consumed). Use the account path if you
 * need automatic reconnection.
 */
interface ConnectOptionsQC extends ConnectOptionsCommon {
  quickConnectCode: string;
  daemonId?: never;
  getAccessToken?: never;
}

/**
 * Account path — user access token + known daemon.
 * `quickConnectCode` is forbidden (type-level `never`).
 */
interface ConnectOptionsAccount extends ConnectOptionsCommon {
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
  quickConnectCode?: never;
}

/**
 * Options for {@link connect}.
 *
 * Auth mode is a discriminated union — `quickConnectCode` and `getAccessToken`
 * are mutually exclusive at the type level. Trust policy is a further
 * discriminated union: `"prompt"` requires `onFirstConnection` and
 * `onIdentityMismatch` callbacks.
 */
export type ConnectOptions =
  | ((ConnectOptionsQC | ConnectOptionsAccount) & {
      /**
       * TOFU trust policy. Defaults to `"auto"` in the cloud context because
       * the control plane has already authenticated the daemon via API key at
       * registration time.
       *
       * ⚠ `"auto"` weakens TOFU guarantees: it silently re-pins on identity
       * mismatch, making it TOFR (Trust On First Registration) rather than
       * strict TOFU. Use `"prompt"` or `"pinned-only"` for higher-assurance scenarios.
       */
      trustPolicy?: "auto" | "pinned-only";
      onFirstConnection?: (info: { fingerprint: string }) => Promise<boolean>;
      onIdentityMismatch?: (info: {
        expectedFingerprint: string;
        receivedFingerprint: string;
      }) => Promise<boolean>;
    })
  | ((ConnectOptionsQC | ConnectOptionsAccount) & {
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
 * @example Account path — persistent, reconnectable
 * ```ts
 * const peer = connect({
 *   daemonId: "d_abc123",
 *   getAccessToken: () => auth.getSessionToken(),
 *   identityKeyStore: store,
 * });
 * await peer.whenReady();
 * ```
 *
 * @example Quick Connect — one-shot bootstrap (code is consumed on connect)
 * ```ts
 * const peer = connect({
 *   quickConnectCode: "abcd-efgh-ijkl",
 *   identityKeyStore: store,
 * });
 * await peer.whenReady();
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
 * Auth mode is selected by the presence of `quickConnectCode` at construction:
 * - QC path: redeems code once (single-use). After the first redeem, any further
 *   `getConnectionParams()` call throws `PeerError(InvalidState)` → fatal.
 * - Account path: fetches a fresh relay session via `getAccessToken` on every
 *   attempt (relay rejects reused sessionIds — new session required each time).
 *
 * @internal Exported for unit testing; not part of the public package API.
 */
export class CloudClientNegotiator {
  // Session token for the current connection attempt — set by
  // getConnectionParams(), consumed by negotiate(). Overwritten on each attempt
  // so reconnects always use a fresh session (relay rejects reused sessionIds).
  // Peer guarantees sequential getConnectionParams/negotiate pairs (never
  // concurrent), so this field is not subject to data races.
  private currentSessionToken: string | null = null;
  /** Set to true after a successful QC redeem. Prevents re-redeeming a single-use code. */
  private qcRedeemed = false;
  /** DaemonId resolved from the QC redeem response; undefined in account path. */
  private resolvedDaemonId: string | undefined;

  constructor(private readonly opts: ConnectOptions) {}

  private get daemonId(): string {
    const id = this.resolvedDaemonId ?? this.opts.daemonId;
    if (!id)
      throw new PeerError(PeerErrorCode.InvalidState, "No daemonId available");
    return id;
  }

  async getConnectionParams() {
    // Clear before awaiting so a stale token is never used if this throws.
    this.currentSessionToken = null;
    // Extract to local const for TypeScript narrowing (class properties are
    // not narrowed reliably across branches and async boundaries).
    const { opts } = this;
    const qcCode =
      typeof opts.quickConnectCode === "string"
        ? opts.quickConnectCode
        : undefined;

    if (qcCode !== undefined) {
      // QC path: one-shot bootstrap — code is consumed on the first attempt.
      if (this.qcRedeemed) {
        // Code is already burned. The session cannot be re-established.
        throw new PeerError(
          PeerErrorCode.InvalidState,
          "Quick Connect session ended — get a new QC code to reconnect",
        );
      }
      // Server atomically consumes the code before checking daemon status
      // (consume-first design — a pre-check would still race). 409 means the
      // code is burned and the daemon is offline; classifyError() treats this
      // as fatal in QC mode so the caller surfaces the true error immediately.
      const result = await redeemQuickConnectCode(qcCode, opts.apiUrl);
      this.resolvedDaemonId = result.daemonId;
      this.currentSessionToken = result.token;
      const url = new URL(result.relayUrl);
      url.searchParams.set("token", result.token);
      this.qcRedeemed = true;
      return { endpoint: url.toString() };
    }

    // Account path: fetch a fresh relay session on every attempt.
    // Relay rejects reused sessionIds (409 conflict) — new session each time.
    const getAccessToken = opts.getAccessToken;
    const daemonId = opts.daemonId;
    if (!getAccessToken || !daemonId) {
      // Belt-and-suspenders: the type system prevents reaching here.
      throw new PeerError(
        PeerErrorCode.InvalidState,
        "No getAccessToken or daemonId provided",
      );
    }
    const accessToken = await getAccessToken();
    const session = await fetchRelaySession(daemonId, accessToken, opts.apiUrl);
    const url = new URL(session.relayUrl);
    url.searchParams.set("token", session.token);
    this.currentSessionToken = session.token;
    return { endpoint: url.toString() };
  }

  async negotiate(transport: TransportConnection) {
    // Extract to local const — TypeScript narrows local const variables
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
    const daemonId = asDaemonId(this.daemonId);
    // Split on the trustPolicy discriminant so each arm is fully type-safe
    // against SbrpClientOptions — no assertion casts needed.
    const inner =
      opts.trustPolicy === "prompt"
        ? relayClientNegotiator({
            daemonId,
            sessionToken,
            identityKeyStore: opts.identityKeyStore,
            trustPolicy: "prompt",
            onFirstConnection: opts.onFirstConnection,
            onIdentityMismatch: opts.onIdentityMismatch,
          })
        : relayClientNegotiator({
            daemonId,
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
    if (error instanceof CloudApiError) {
      // In QC mode the server atomically consumes the code before the daemon
      // online check, so 409 (daemon offline) always means the code is burned.
      // Fatal immediately — retrying would only produce a misleading 404.
      if (
        typeof this.opts.quickConnectCode === "string" &&
        error.status === 409
      )
        return "fatal";
      return classifyApiError(error);
    }
    // Local invariant errors (e.g. QC code already redeemed) are always fatal —
    // retrying cannot fix a violated invariant.
    if (error instanceof PeerError && error.code === PeerErrorCode.InvalidState)
      return "fatal";
    return classifySbrpError(error);
  }
}
