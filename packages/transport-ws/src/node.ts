// SPDX-License-Identifier: Apache-2.0

/**
 * Node.js/Bun WebSocket transport for Sideband.
 *
 * Client: Uses `ws` package for Node.js, native WebSocket for Bun.
 * Server: Uses `ws.WebSocketServer` for Node.js, `Bun.serve` for Bun.
 *
 * @module @sideband/transport-ws/node
 */

import type {
  ConnectionHandler,
  Transport,
  TransportConnection,
  TransportEndpoint,
  TransportListener,
} from "@sideband/transport";
import { TransportError, unsafeAsTransportEndpoint } from "@sideband/transport";
import type { ServerWebSocket } from "bun";
import { WsConnection } from "./connection.js";
import type {
  OriginPolicy,
  WsConnectOptions,
  WsListenOptions,
} from "./types.js";
import { normalizeError } from "./ws-errors.js";

export * from "./ws-errors.js";

// Detect Bun at runtime (isBun check before any dynamic import)
const isBun = typeof Bun !== "undefined";

// Default localhost origins for "localhost" policy
const LOCALHOST_ORIGINS = [
  "http://localhost",
  "https://localhost",
  "http://127.0.0.1",
  "https://127.0.0.1",
  "http://[::1]",
  "https://[::1]",
];

/**
 * Check if origin passes the origin policy.
 * Missing origin (non-browser clients) is always allowed.
 */
function checkOrigin(
  origin: string | undefined,
  policy: OriginPolicy,
  request?: unknown,
): boolean {
  // Missing origin is always allowed (non-browser clients like CLI, other servers)
  if (origin === undefined) return true;

  if (policy === "any") return true;

  if (policy === "localhost") {
    return LOCALHOST_ORIGINS.some(
      (allowed) => origin === allowed || origin.startsWith(allowed + ":"),
    );
  }

  if (typeof policy === "object" && "allow" in policy) {
    return policy.allow.includes(origin);
  }

  if (typeof policy === "function") {
    return policy(origin, request);
  }

  return false;
}

/**
 * Check if endpoint is localhost.
 */
function isLocalhostEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}

/**
 * Select subprotocol based on options.
 * Returns undefined if no match (RFC 6455 allows accepting without subprotocol).
 */
function selectSubprotocol(
  clientOffers: string[],
  options?: WsListenOptions,
): string | undefined {
  if (options?.subprotocols?.select) {
    return options.subprotocols.select(clientOffers);
  }
  if (options?.subprotocols?.offer) {
    for (const offered of clientOffers) {
      if (options.subprotocols.offer.includes(offered)) {
        return offered;
      }
    }
  }
  return undefined;
}

/** WebSocket data type for Bun server */
interface BunWsData {
  protocol?: string;
}

/**
 * Node.js/Bun WebSocket transport.
 */
class NodeWsTransport implements Transport {
  readonly kind = isBun ? "bun:ws" : "node:ws";

  async connect(
    endpoint: TransportEndpoint,
    options?: WsConnectOptions,
  ): Promise<TransportConnection> {
    // Validate auth vs headers conflict
    if (options?.auth && options.advanced?.headers?.["Authorization"]) {
      throw new TransportError(
        "transport_failure",
        "Cannot set both `auth` and `advanced.headers.Authorization`.",
      );
    }

    // Check abort signal before attempting connection
    if (options?.signal?.aborted) {
      throw new TransportError(
        "aborted",
        "Connection aborted by signal",
        options.signal.reason,
      );
    }

    // Build URL with query params
    const url = new URL(endpoint);

    // Add auth as query if mode is "query"
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

    // Build headers (Node/Bun default to header mode for auth)
    const headers: Record<string, string> = { ...options?.advanced?.headers };

    // Add auth header (default mode for Node/Bun)
    if (options?.auth && options.auth.mode !== "query") {
      const headerName = options.auth.headerName ?? "Authorization";
      headers[headerName] = options.auth.token;
    }

    const protocols = options?.subprotocols?.offer;
    const requireSelection = options?.subprotocols?.requireSelection ?? false;

    // Create WebSocket based on platform
    let ws: WebSocket;
    try {
      if (isBun) {
        // Bun native WebSocket
        ws = new WebSocket(url.toString(), protocols);
        // Note: Bun doesn't support custom headers in WebSocket constructor
        // Headers must be passed differently (e.g., via URL query params)
      } else {
        // Node.js: use ws package (dynamic import resolved at module load)
        const { WebSocket: WsWebSocket } = await import("ws");
        ws = new WsWebSocket(url.toString(), protocols, {
          headers,
          ...(options?.advanced?.tls && {
            rejectUnauthorized: options.advanced.tls.rejectUnauthorized,
            ca: options.advanced.tls.ca,
            cert: options.advanced.tls.cert,
            key: options.advanced.tls.key,
            passphrase: options.advanced.tls.passphrase,
          }),
        }) as unknown as WebSocket;
      }
    } catch (err) {
      throw normalizeError(err);
    }

    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        options?.signal?.removeEventListener("abort", abortHandler);
      };

      const abortHandler = () => {
        cleanup();
        try {
          ws.close();
        } catch {
          // Ignore close errors
        }
        reject(new TransportError("aborted", "Connection aborted by signal"));
      };

      // Timeout handling
      if (options?.timeoutMs) {
        timeoutId = setTimeout(() => {
          cleanup();
          try {
            ws.close();
          } catch {
            // Ignore
          }
          reject(
            new TransportError(
              "timeout",
              `Connect timeout after ${options.timeoutMs}ms`,
            ),
          );
        }, options.timeoutMs);
      }

      // Abort signal handling
      options?.signal?.addEventListener("abort", abortHandler, { once: true });

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
          subprotocol: selectedProtocol || undefined,
          limits: options?.limits,
        });
        conn._markOpen();
        resolve(conn);
      };

      ws.onerror = (event: Event) => {
        cleanup();
        reject(normalizeError(event));
      };

      ws.onclose = (event: CloseEvent) => {
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

  async listen(
    endpoint: TransportEndpoint,
    handler: ConnectionHandler,
    options?: WsListenOptions,
  ): Promise<TransportListener> {
    const url = new URL(endpoint);
    // Parse port explicitly to handle port 0 (ephemeral) correctly
    const port = url.port
      ? parseInt(url.port)
      : url.protocol === "wss:"
        ? 443
        : 80;
    const host = url.hostname;

    // Determine origin policy (default: localhost for localhost endpoints, any otherwise)
    const originPolicy =
      options?.originPolicy ??
      (isLocalhostEndpoint(endpoint) ? "localhost" : "any");

    if (isBun) {
      return this._listenBun(
        endpoint,
        host,
        port,
        handler,
        options,
        originPolicy,
      );
    } else {
      return this._listenNode(
        endpoint,
        host,
        port,
        handler,
        options,
        originPolicy,
      );
    }
  }

  private async _listenNode(
    endpoint: TransportEndpoint,
    host: string,
    port: number,
    handler: ConnectionHandler,
    options: WsListenOptions | undefined,
    originPolicy: OriginPolicy,
  ): Promise<TransportListener> {
    const { WebSocketServer } = await import("ws");
    const url = new URL(endpoint);

    const wss = new WebSocketServer({
      host,
      port,
      maxPayload: options?.limits?.maxMessageSize ?? 1048576,
      verifyClient: (info: { origin?: string; req: unknown }) => {
        try {
          return checkOrigin(info.origin, originPolicy, info.req);
        } catch (err) {
          // originPolicy callback threw
          console.error("Origin policy callback error:", err);
          return false;
        }
      },
      handleProtocols: (protocols: Set<string>, _request: unknown) => {
        const clientOffers = [...protocols];
        try {
          return selectSubprotocol(clientOffers, options) || false;
        } catch (err) {
          // select callback threw
          console.error("Subprotocol select callback error:", err);
          return false;
        }
      },
    });

    return new Promise((resolve, reject) => {
      const errorHandler = (err: Error) => {
        reject(normalizeError(err));
      };

      wss.on("error", errorHandler);

      wss.on("listening", () => {
        const addr = wss.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : port;
        const actualEndpoint = unsafeAsTransportEndpoint(
          `${url.protocol}//${host}:${actualPort}`,
        );

        wss.off("error", errorHandler);

        wss.on("connection", (ws, req) => {
          // Derive remote endpoint for diagnostics
          const remoteAddr = req.socket?.remoteAddress ?? "unknown";
          const remotePort = req.socket?.remotePort ?? 0;
          const remoteEndpoint = unsafeAsTransportEndpoint(
            `${url.protocol}//${remoteAddr}:${remotePort}`,
          );

          const conn = new WsConnection({
            ws: ws as unknown as WebSocket,
            endpoint: remoteEndpoint,
            subprotocol: ws.protocol || undefined,
            limits: options?.limits,
          });
          conn._markOpen();

          // Call handler (isolate errors per ABI spec)
          Promise.resolve()
            .then(() => handler(conn))
            .catch((err) => {
              console.error("Connection handler error:", err);
              conn.close({ closeCode: 1011, reason: "Internal error" });
            });
        });

        resolve({
          address: actualEndpoint,
          close: async () => {
            return new Promise<void>((res) => {
              wss.close(() => res());
            });
          },
        });
      });
    });
  }

  private async _listenBun(
    endpoint: TransportEndpoint,
    host: string,
    port: number,
    handler: ConnectionHandler,
    options: WsListenOptions | undefined,
    originPolicy: OriginPolicy,
  ): Promise<TransportListener> {
    const url = new URL(endpoint);

    // Store connections by WebSocket for later retrieval in message handler
    const connections = new WeakMap<ServerWebSocket<BunWsData>, WsConnection>();

    const server = Bun.serve<BunWsData>({
      hostname: host,
      port,
      fetch(req, server) {
        // Origin validation
        const origin = req.headers.get("origin") ?? undefined;
        try {
          if (!checkOrigin(origin, originPolicy, req)) {
            return new Response("Forbidden", { status: 403 });
          }
        } catch (err) {
          console.error("Origin policy callback error:", err);
          return new Response("Forbidden", { status: 403 });
        }

        // Subprotocol selection
        const wsProtocols = req.headers.get("sec-websocket-protocol");
        const clientOffers = wsProtocols?.split(",").map((p) => p.trim()) ?? [];
        let selectedProtocol: string | undefined;

        try {
          selectedProtocol = selectSubprotocol(clientOffers, options);
        } catch (err) {
          console.error("Subprotocol select callback error:", err);
          return new Response("Bad Request", { status: 400 });
        }

        // Bun auto-accepts the first offered subprotocol; there's no way to reject all.
        // We store selectedProtocol in data, but Bun may accept a protocol even when
        // selectSubprotocol() returns undefined. See https://github.com/oven-sh/bun/issues/18243
        const success = server.upgrade(req, {
          data: { protocol: selectedProtocol },
        });

        return success
          ? undefined
          : new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        maxPayloadLength: options?.limits?.maxMessageSize ?? 1048576,
        message(ws, data) {
          // Forward message to connection's internal handler
          const conn = connections.get(ws);
          if (conn) {
            // Simulate onmessage event for WsConnection
            const event = new MessageEvent("message", {
              data:
                data instanceof ArrayBuffer ? data : (data as Buffer).buffer,
            });
            (conn as unknown as { _ws: WebSocket })._ws.onmessage?.(event);
          }
        },
        open(ws) {
          // Get remote address for diagnostics
          const remoteAddr = ws.remoteAddress ?? "unknown";
          const remoteEndpoint = unsafeAsTransportEndpoint(
            `${url.protocol}//${remoteAddr}`,
          );

          // Create a WebSocket-like wrapper for Bun's ServerWebSocket
          const wsWrapper = createBunWsWrapper(ws);

          const conn = new WsConnection({
            ws: wsWrapper,
            endpoint: remoteEndpoint,
            subprotocol: ws.data?.protocol,
            limits: options?.limits,
          });
          conn._markOpen();

          connections.set(ws, conn);

          // Call handler (isolate errors)
          Promise.resolve()
            .then(() => handler(conn))
            .catch((err) => {
              console.error("Connection handler error:", err);
              conn.close({ closeCode: 1011, reason: "Internal error" });
            });
        },
        close(ws, code, reason) {
          const conn = connections.get(ws);
          if (conn) {
            // Trigger close event on the wrapper
            const wsWrapper = (conn as unknown as { _ws: WebSocket })._ws;
            const event = new CloseEvent("close", { code, reason });
            wsWrapper.onclose?.(event);
            connections.delete(ws);
          }
        },
      },
    });

    const actualEndpoint = unsafeAsTransportEndpoint(
      `${url.protocol}//${host}:${server.port}`,
    );

    return {
      address: actualEndpoint,
      close: async () => {
        server.stop();
      },
    };
  }
}

/**
 * Create a WebSocket-like wrapper for Bun's ServerWebSocket.
 * This allows WsConnection to work uniformly with both browser WebSocket and Bun's server sockets.
 */
function createBunWsWrapper(bunWs: ServerWebSocket<BunWsData>): WebSocket {
  const wrapper = {
    // Properties
    get readyState(): number {
      return bunWs.readyState;
    },
    get bufferedAmount(): number {
      // LIMITATION: Bun ServerWebSocket doesn't expose bufferedAmount.
      // This means backpressure checking in send() only validates message size,
      // not accumulated buffer. Bun servers may accept more data than intended
      // if the socket's internal queue is full. For production use with high
      // throughput, implement application-level flow control.
      return 0;
    },
    get protocol(): string {
      return bunWs.data?.protocol ?? "";
    },
    binaryType: "arraybuffer" as const,
    get url(): string {
      return "";
    },
    get extensions(): string {
      return "";
    },

    // Constants
    CONNECTING: 0 as const,
    OPEN: 1 as const,
    CLOSING: 2 as const,
    CLOSED: 3 as const,

    // Methods
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (data instanceof Blob) {
        throw new Error("Blob not supported");
      }
      if (ArrayBuffer.isView(data)) {
        bunWs.send(
          new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        );
      } else if (typeof data === "string") {
        bunWs.send(data);
      } else {
        bunWs.send(data as ArrayBuffer);
      }
    },
    close(code?: number, reason?: string): void {
      bunWs.close(code, reason);
    },

    // Event handlers (set by WsConnection)
    onopen: null as ((ev: Event) => void) | null,
    onmessage: null as ((ev: MessageEvent) => void) | null,
    onerror: null as ((ev: Event) => void) | null,
    onclose: null as ((ev: CloseEvent) => void) | null,

    // EventTarget methods (minimal implementation)
    addEventListener(): void {},
    removeEventListener(): void {},
    dispatchEvent(): boolean {
      return false;
    },
  };

  return wrapper as unknown as WebSocket;
}

/**
 * Create a Node.js/Bun WebSocket transport.
 *
 * @example
 * ```typescript
 * import { nodeWsTransport } from "@sideband/transport-ws/node";
 * import { unsafeAsTransportEndpoint } from "@sideband/transport";
 *
 * const transport = nodeWsTransport();
 *
 * // Client connection
 * const conn = await transport.connect(
 *   unsafeAsTransportEndpoint("ws://localhost:8080"),
 *   { auth: { token: "secret" } }
 * );
 *
 * // Server
 * const listener = await transport.listen(
 *   unsafeAsTransportEndpoint("ws://localhost:8080"),
 *   (conn) => { console.log("New connection:", conn.id); }
 * );
 * ```
 */
export function nodeWsTransport(): Transport {
  return new NodeWsTransport();
}

// Re-export types for convenience
export type {
  OriginPolicy,
  WsConnectOptions,
  WsListenOptions,
} from "./types.js";
