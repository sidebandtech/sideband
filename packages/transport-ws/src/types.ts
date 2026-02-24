// SPDX-License-Identifier: Apache-2.0

/**
 * WebSocket transport types for Sideband.
 */

import type {
  ConnectOptions,
  ListenOptions,
  TransportEndpoint,
} from "@sideband/transport";

/**
 * WebSocket endpoint (branded TransportEndpoint).
 */
export type WsEndpoint = TransportEndpoint & { readonly __wsEndpoint: true };

/**
 * Platform detection override.
 */
export type WsPlatform = "browser" | "node" | "bun";

/**
 * Transport-level options.
 */
export interface WsTransportOptions {
  /** Override auto-detection (useful for testing) */
  platform?: WsPlatform;
}

/**
 * Subprotocol negotiation options.
 */
export interface SubprotocolOptions {
  /**
   * Subprotocols to offer during handshake.
   * Default: undefined (no subprotocol requested)
   */
  offer?: string[];

  /**
   * Whether to fail if server doesn't select a requested subprotocol.
   * Default: false (transport is generic; Sideband policy is opt-in)
   */
  requireSelection?: boolean;

  /**
   * Server-side: custom subprotocol selection logic.
   * Called with the client's offered subprotocols.
   * Return the selected subprotocol, or undefined to accept without subprotocol.
   *
   * Default: select first client offer that appears in server's `offer` list.
   */
  select?: (clientOffers: string[]) => string | undefined;
}

/**
 * Connection limits.
 */
export interface WsLimits {
  /** Max single message size. Default: 1 MiB (1048576) */
  maxMessageSize?: number;
  /** Max bytes queued for sending. Default: 16 MiB */
  maxSendBufferBytes?: number;
  /** Max bytes buffered for inbound. Default: 16 MiB */
  maxInboundBufferBytes?: number;
}

/**
 * Authentication options.
 */
export interface WsAuthOptions {
  /** Authentication token */
  token: string;
  /**
   * How to send the token.
   * - "header": Authorization header (Node/Bun only, throws in browser)
   * - "query": URL query parameter
   * Default: "header" in Node/Bun, throws in browser (forces explicit choice)
   */
  mode?: "header" | "query";
  /** Header name when mode="header". Default: "Authorization" */
  headerName?: string;
  /** Query param name when mode="query". Default: "token" */
  queryParam?: string;
}

/**
 * TLS connection options (Node.js only).
 * Passthrough to node:tls TlsConnectOpts.
 */
export interface WsTlsOptions {
  /** If false, server certificate is not verified. Default: true */
  rejectUnauthorized?: boolean;
  /** Override server name for SNI. */
  servername?: string;
  /** PEM-encoded CA certificates to trust. */
  ca?: string | Buffer | Array<string | Buffer>;
  /** PEM-encoded client certificate. */
  cert?: string | Buffer | Array<string | Buffer>;
  /** PEM-encoded client private key. */
  key?: string | Buffer | Array<string | Buffer>;
  /** Passphrase for private key. */
  passphrase?: string;
  /** Additional TLS options (passthrough to node:tls). */
  [key: string]: unknown;
}

/**
 * Advanced/escape-hatch options for connections.
 */
export interface WsAdvancedOptions {
  /** Custom headers (Node/Bun only, ignored in browser) */
  headers?: Record<string, string>;
  /** Query params to append to URL */
  query?: Record<string, string>;
  /** TLS options passthrough (Node only) */
  tls?: WsTlsOptions;
}

/**
 * WebSocket-specific connect options.
 */
export interface WsConnectOptions extends ConnectOptions {
  /** Subprotocol negotiation options */
  subprotocols?: SubprotocolOptions;
  /** Connection limits */
  limits?: WsLimits;
  /** Authentication token. Mutually exclusive with advanced.headers.Authorization */
  auth?: WsAuthOptions;
  /** Advanced/escape-hatch options */
  advanced?: WsAdvancedOptions;
}

/**
 * Origin validation policy for DNS rebinding protection.
 */
export type OriginPolicy =
  | "any" // Allow any origin (including absent)
  | "localhost" // Allow localhost origins (absent OK)
  | { allow: string[] } // Allow specific origins (absent OK)
  | ((origin: string | undefined, request: unknown) => boolean); // Custom

/**
 * WebSocket-specific listen options.
 */
export interface WsListenOptions extends ListenOptions {
  /** Subprotocol negotiation options */
  subprotocols?: SubprotocolOptions;
  /** Connection limits */
  limits?: WsLimits;
  /**
   * Origin validation policy for DNS rebinding protection.
   *
   * Default behavior:
   * - Localhost listeners: allow localhost origins only
   * - Non-localhost listeners: allow any origin
   *
   * When Origin header is absent (non-browser clients):
   * connection is allowed (Origin is not auth).
   */
  originPolicy?: OriginPolicy;
}

/**
 * I/O diagnostics for connection monitoring.
 */
export interface IoBytes {
  /** Total bytes sent */
  sent: number;
  /** Total bytes received */
  received: number;
}
