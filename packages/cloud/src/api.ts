// SPDX-License-Identifier: Apache-2.0

/**
 * Internal helpers for talking to the api.sideband.cloud control plane.
 *
 * The API is a tRPC server mounted at `/api/trpc`. We call mutations
 * directly over HTTP without the tRPC client library to keep the
 * bundle lean and avoid a runtime dependency on @trpc/client.
 */

export const DEFAULT_API = "https://api.sideband.cloud";

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
  result?: { data?: { json: T } };
  error?: { json?: { message?: string; code?: string } };
}

async function trpcMutation<TInput, TOutput>(
  api: string,
  procedure: string,
  input: TInput,
  headers: Record<string, string>,
): Promise<TOutput> {
  const res = await fetch(`${api}/api/trpc/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ json: input }),
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as TrpcResponse<TOutput>;
      const trpcMsg = body.error?.json?.message;
      if (trpcMsg) message = `HTTP ${res.status}: ${trpcMsg}`;
    } catch {
      // Ignore JSON parse errors
    }
    throw new CloudApiError(
      res.status,
      `api.sideband.cloud ${procedure} failed — ${message}`,
    );
  }

  const body = (await res.json()) as TrpcResponse<TOutput>;
  if (body.error) {
    const msg = body.error.json?.message ?? "Unknown error";
    const code = body.error.json?.code;
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
              : 500;
    throw new CloudApiError(
      status,
      `api.sideband.cloud ${procedure} error — ${msg}`,
    );
  }

  const out = body.result?.data?.json;
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
): Promise<{ relayUrl: string; token: string }> {
  return trpcMutation(
    apiUrl,
    "relay.createSession",
    { daemonId },
    { Authorization: `Bearer ${accessToken}` },
  );
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
): Promise<string> {
  const result = await trpcMutation<null, { presenceToken: string }>(
    apiUrl,
    "daemon.renewToken",
    null,
    { Authorization: `Bearer ${apiKey}` },
  );
  return result.presenceToken;
}

/**
 * Classify a CloudApiError as fatal or retryable.
 * 400 = bad request (fatal — retrying the same payload won't help).
 * 401/403 = wrong credentials (fatal — retrying won't help).
 * 404 = daemon not found (fatal).
 * 429/5xx/network = transient (retryable with backoff).
 */
export function classifyApiError(error: CloudApiError): "fatal" | "retryable" {
  if (error.status === 400 || error.status === 401 || error.status === 403)
    return "fatal";
  if (error.status === 404) return "fatal";
  return "retryable";
}
