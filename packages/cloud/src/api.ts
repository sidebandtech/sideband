// SPDX-License-Identifier: Apache-2.0

/**
 * Internal helpers for talking to the api.sideband.cloud control plane.
 *
 * The API is a tRPC server mounted at `/api/trpc`. We call mutations
 * directly over HTTP without the tRPC client library to keep the
 * bundle lean and avoid a runtime dependency on @trpc/client.
 */

export const DEFAULT_API = "https://api.sideband.cloud";

const dec = new TextDecoder();

/**
 * Error thrown when api.sideband.cloud returns an HTTP error response.
 * Carries the HTTP status so `classifyError()` can distinguish fatal
 * (400, 401, 403, 404) from retryable (429, 5xx) failures without string parsing.
 */
export class CloudApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CloudApiError";
  }
}

interface TrpcResponse<T> {
  result?: { data?: T };
  error?: { message?: string; data?: { code?: string } };
}

async function trpcMutation<TInput, TOutput>(
  api: string,
  procedure: string,
  input: TInput,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<TOutput> {
  const res = await fetch(`${api}/api/trpc/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ json: input }),
    signal,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as TrpcResponse<TOutput>;
      const trpcMsg = body.error?.message;
      if (trpcMsg) message = `HTTP ${res.status}: ${trpcMsg}`;
    } catch {
      // Ignore JSON parse errors
    }
    throw new CloudApiError(
      res.status,
      `api.sideband.cloud ${procedure} failed — ${message}`,
    );
  }

  let body: TrpcResponse<TOutput>;
  try {
    body = (await res.json()) as TrpcResponse<TOutput>;
  } catch {
    // Proxy or WAF returned non-JSON on 200 (captive portal or WAF intercept?).
    throw new CloudApiError(
      500,
      `api.sideband.cloud ${procedure}: non-JSON response on HTTP 200 — possible captive portal or WAF intercept`,
    );
  }
  if (body.error) {
    const msg = body.error.message ?? "Unknown error";
    const code = body.error.data?.code;
    // Map known fatal tRPC error codes to their HTTP equivalents so
    // classifyApiError() treats them as fatal (stops retrying).
    // All other tRPC errors default to 500 (retryable).
    const status =
      code === "UNAUTHORIZED"
        ? 401
        : code === "FORBIDDEN"
          ? 403
          : code === "NOT_FOUND"
            ? 404
            : code === "BAD_REQUEST"
              ? 400
              : code === "CONFLICT"
                ? 409
                : 500;
    throw new CloudApiError(
      status,
      `api.sideband.cloud ${procedure} error — ${code ? `[${code}] ` : ""}${msg}`,
    );
  }

  const out = body.result?.data;
  if (out === undefined) {
    throw new CloudApiError(
      500,
      `api.sideband.cloud ${procedure}: unexpected response format`,
    );
  }
  return out as TOutput;
}

/**
 * Create a relay session for the given daemon using the user's access token.
 * Returns the relay WebSocket URL (region-specific if the daemon has a pinned
 * region) and a short-lived client session JWT (role=client, TTL≤2min).
 *
 * Must be called on every connect attempt — session tokens are single-use
 * and reuse causes a 409 ghost-socket collision on the relay.
 */
export async function fetchRelaySession(
  daemonId: string,
  accessToken: string,
  apiUrl = DEFAULT_API,
  signal?: AbortSignal,
): Promise<{ relayUrl: string; token: string }> {
  return trpcMutation(
    apiUrl,
    "relay.createSession",
    { daemonId },
    { Authorization: `Bearer ${accessToken}` },
    signal,
  );
}

/**
 * Redeem a Quick Connect code for a relay session.
 * Returns the relay WebSocket URL, a short-lived client session JWT, and the
 * daemonId. The code is the credential — no auth header required.
 *
 * QC codes are single-use: a second call with the same code returns NOT_FOUND
 * (404 → fatal). CONFLICT (409) means the daemon was offline; the code is
 * already burned — the server atomically consumes the code before the online
 * check (consume-first design). Caller must prompt the user for a new code.
 */
export async function redeemQuickConnectCode(
  code: string,
  apiUrl = DEFAULT_API,
  signal?: AbortSignal,
): Promise<{ relayUrl: string; token: string; daemonId: string }> {
  return trpcMutation(apiUrl, "quickConnect.redeem", { code }, {}, signal);
}

/**
 * Renew a daemon presence token using its API key.
 * Returns a fresh JWT (role=daemon, TTL=1h) for authenticating with the relay.
 *
 * Called on every relay connect attempt so the daemon's presence token is
 * always valid when establishing the WebSocket connection.
 */
export async function renewPresenceToken(
  apiKey: string,
  apiUrl = DEFAULT_API,
  signal?: AbortSignal,
): Promise<string> {
  const result = await trpcMutation<null, { presenceToken: string }>(
    apiUrl,
    "daemon.renewToken",
    null,
    { Authorization: `Bearer ${apiKey}` },
    signal,
  );
  return result.presenceToken;
}

/**
 * Extract the daemon ID from a presence token (`did` JWT claim).
 *
 * Does not verify the signature — the relay validates the full token at
 * WebSocket upgrade time. Throws `CloudApiError(400, ...)` for malformed tokens.
 */
export function extractDaemonIdFromToken(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new CloudApiError(
      400,
      "Invalid presence token: not a JWT (expected 3 segments)",
    );
  }

  let payload: Record<string, unknown>;
  try {
    const payloadBytes = base64urlDecode(parts[1]!);
    payload = JSON.parse(dec.decode(payloadBytes)) as Record<string, unknown>;
  } catch {
    throw new CloudApiError(
      400,
      "Invalid presence token: payload is not valid base64url JSON",
    );
  }

  const did = payload["did"];
  if (typeof did !== "string" || did === "") {
    throw new CloudApiError(
      400,
      "Invalid presence token: missing or empty did claim",
    );
  }
  return did;
}

/** Decode a base64url string to bytes (no padding required). */
function base64urlDecode(input: string): Uint8Array {
  // Convert base64url to standard base64
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Classify a CloudApiError as fatal or retryable.
 * 400 = bad request (fatal — retrying the same payload won't help).
 * 401/403 = wrong credentials (fatal — retrying won't help).
 * 404 = daemon not found (fatal).
 * 429/5xx/network = transient (retryable with backoff).
 */
export function classifyApiError(error: CloudApiError): "fatal" | "retryable" {
  if ([400, 401, 403, 404].includes(error.status)) return "fatal";
  return "retryable";
}
