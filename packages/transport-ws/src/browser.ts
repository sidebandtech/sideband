// SPDX-License-Identifier: Apache-2.0

/**
 * Browser WebSocket transport for Sideband.
 * Client-only (browsers cannot listen for WebSocket connections).
 */

import type {
  Transport,
  TransportConnection,
  TransportEndpoint,
} from "@sideband/transport";
import { TransportError } from "@sideband/transport";
import { WsConnection } from "./connection.js";
import type { WsConnectOptions, WsEndpoint } from "./types.js";
import { normalizeError } from "./ws-errors.js";

export { WsConnection } from "./connection.js";
export type { WsConnectOptions, WsEndpoint };

/**
 * Browser WebSocket transport.
 * Implements Transport interface using native browser WebSocket API.
 */
class BrowserWsTransport implements Transport {
  readonly kind = "browser:ws";

  async connect(
    endpoint: TransportEndpoint,
    options?: WsConnectOptions,
  ): Promise<TransportConnection> {
    // Validate auth options for browser
    if (options?.auth) {
      if (options.auth.mode === "header") {
        throw new TransportError(
          "transport_failure",
          "Browsers cannot set WebSocket headers. Use `auth: { mode: 'query' }` explicitly.",
        );
      }
      if (options.auth.mode === undefined) {
        throw new TransportError(
          "transport_failure",
          "Browser requires explicit auth mode. Use `auth: { token, mode: 'query' }`.",
        );
      }
    }

    // Validate auth vs advanced.headers conflict
    if (options?.auth && options.advanced?.headers?.["Authorization"]) {
      throw new TransportError(
        "transport_failure",
        "Cannot set both `auth` and `advanced.headers.Authorization`.",
      );
    }

    // Build URL with query params
    const url = new URL(endpoint);

    // Add auth token as query param
    if (options?.auth?.mode === "query") {
      const paramName = options.auth.queryParam ?? "token";
      url.searchParams.set(paramName, options.auth.token);
    }

    // Add advanced query params
    if (options?.advanced?.query) {
      for (const [key, value] of Object.entries(options.advanced.query)) {
        url.searchParams.set(key, value);
      }
    }

    // Get subprotocols
    const protocols = options?.subprotocols?.offer;
    const requireSelection = options?.subprotocols?.requireSelection ?? false;

    return new Promise((resolve, reject) => {
      // Handle abort signal
      if (options?.signal?.aborted) {
        reject(new TransportError("aborted", "Connection aborted by signal"));
        return;
      }

      let ws: WebSocket;
      try {
        ws =
          protocols && protocols.length > 0
            ? new WebSocket(url.toString(), protocols)
            : new WebSocket(url.toString());
      } catch (err) {
        reject(normalizeError(err));
        return;
      }

      // Timeout handling
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (options?.timeoutMs) {
        timeoutId = setTimeout(() => {
          ws.close();
          reject(
            new TransportError(
              "timeout",
              `Connect timeout after ${options.timeoutMs}ms`,
            ),
          );
        }, options.timeoutMs);
      }

      // Abort signal handling
      const abortHandler = () => {
        cleanup();
        ws.close();
        reject(new TransportError("aborted", "Connection aborted by signal"));
      };
      options?.signal?.addEventListener("abort", abortHandler, { once: true });

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        options?.signal?.removeEventListener("abort", abortHandler);
      };

      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        cleanup();

        // Check subprotocol selection
        const selectedProtocol = ws.protocol;
        if (requireSelection && protocols && protocols.length > 0) {
          if (!selectedProtocol) {
            ws.close(1002, "Server did not select required subprotocol");
            reject(
              new TransportError(
                "subprotocol_mismatch",
                `Server did not select any of the offered subprotocols: ${protocols.join(", ")}`,
              ),
            );
            return;
          }
          // Validate that server selected a protocol we actually offered
          if (!protocols.includes(selectedProtocol)) {
            ws.close(1002, "Server selected unlisted subprotocol");
            reject(
              new TransportError(
                "subprotocol_mismatch",
                `Server selected "${selectedProtocol}" which was not in offered list: ${protocols.join(", ")}`,
              ),
            );
            return;
          }
        }

        const conn = new WsConnection({
          ws,
          endpoint,
          subprotocol: ws.protocol || undefined,
          limits: options?.limits,
        });
        conn._markOpen();
        resolve(conn);
      };

      ws.onerror = () => {
        // Browser WebSocket error is opaque; wait for onclose
      };

      ws.onclose = (event) => {
        cleanup();
        reject(
          normalizeError(new Error(`WebSocket closed: ${event.code}`), {
            closeCode: event.code,
            reason: event.reason,
          }),
        );
      };
    });
  }

  // Browser cannot listen for WebSocket connections
  listen = undefined;
}

/**
 * Create a WebSocket endpoint from a URL.
 * Validates that the URL uses ws: or wss: scheme.
 * Strips hash fragment (not sent to server per RFC 6455).
 */
export function wsEndpoint(url: string | URL): WsEndpoint {
  const parsed =
    typeof url === "string" ? new URL(url) : new URL(url.toString());

  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error(
      `Invalid WebSocket URL scheme: ${parsed.protocol}. Use ws: or wss:.`,
    );
  }

  // Strip hash (not sent to server per RFC 6455)
  parsed.hash = "";

  return parsed.toString() as WsEndpoint;
}

/**
 * Convert HTTP(S) URL to WebSocket URL.
 * http: -> ws:, https: -> wss:
 * Strips hash fragment.
 */
export function wsEndpointFromHttp(url: string | URL): WsEndpoint {
  const parsed =
    typeof url === "string" ? new URL(url) : new URL(url.toString());

  if (parsed.protocol === "http:") {
    parsed.protocol = "ws:";
  } else if (parsed.protocol === "https:") {
    parsed.protocol = "wss:";
  } else if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error(`Cannot convert ${parsed.protocol} to WebSocket URL.`);
  }

  parsed.hash = "";
  return parsed.toString() as WsEndpoint;
}

/**
 * Create a browser WebSocket transport.
 */
export function browserWsTransport(): Transport {
  return new BrowserWsTransport();
}
