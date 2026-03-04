# @sideband/cloud

High-level SDK for [relay.sideband.cloud](https://sideband.cloud). Wraps `@sideband/peer` and `@sideband/secure-relay` with automatic relay session management, presence token renewal, and E2EE.

## Install

```bash
bun add @sideband/cloud
```

## Quick start

### Client (account path)

```ts
import { connect, createIndexedDBIdentityKeyStore } from "@sideband/cloud";

const peer = connect({
  daemonId: "d_abc123",
  getAccessToken: () => auth.getSessionToken(), // called on each connect attempt
  identityKeyStore: createIndexedDBIdentityKeyStore(),
});

peer.rpc.handle("push", handlePush); // register before connection completes
await peer.whenReady();
const result = await peer.rpc.call("ping");
```

### Client (Quick Connect)

```ts
import { connect, createIndexedDBIdentityKeyStore } from "@sideband/cloud";

const peer = connect({
  quickConnectCode: "abcd-efgh-ijkl",
  identityKeyStore: createIndexedDBIdentityKeyStore(),
});
await peer.whenReady();
```

QC codes are single-use: the code is consumed on the first connection. If the connection later drops, the peer terminates fatally — use the account path for persistent, reconnectable sessions.

### Identity key store

TOFU pins are stored in an `IdentityKeyStore`. Two implementations are provided:

| Store                               | Use case                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `createIndexedDBIdentityKeyStore()` | Browser — pins persist across reloads (best-effort; cleared in private mode or by user action) |
| `createMemoryIdentityKeyStore()`    | Node/Bun/tests — ephemeral, pins lost on process exit                                          |

### Daemon

```ts
import { listen, generateIdentityKeyPair } from "@sideband/cloud";

// daemonId is optional — extracted from the presence token's `did` claim.
const server = await listen({
  apiKey: process.env.SIDEBAND_API_KEY,
  identityKeyPair: await loadOrCreateIdentityKeyPair(),
  onConnection(peer) {
    peer.rpc.handle("ping", () => "pong");
  },
});
```

`listen()` makes an outbound WebSocket to the relay (not a local port bind) and demultiplexes incoming SBRP sessions from multiple clients over it. Resolves once the first relay connection succeeds — transient failures (network unavailable, 502, DNS) are retried with exponential backoff before resolving. Only fatal API errors (400/401/403/404) reject immediately.

If `daemonId` is provided it is validated against the token's `did` claim on startup. A mismatch (API key belongs to a different daemon) throws `CloudApiError(400)` immediately, making misconfiguration obvious.

Pass a `signal` to cancel startup before the first connect. Use `server.close()` to stop a running daemon. Override `relayUrl` for staging or self-hosted relays.

**Daemon identity key**: generate once and persist securely. Regenerating causes a TOFU mismatch for all clients.

## Reconnection

**Client** (`connect()`) — account path: auto-reconnects with cloud-appropriate defaults:

- `connectionPolicy.onDisconnect: "pause"` — RPCs buffer across reconnects, flushed on re-activation
- `retryPolicy.mode: "on-error"` — reconnect automatically on transport drops

A fresh relay session is fetched from `api.sideband.cloud` on every connect attempt — relay rejects reused session IDs with 409.

**Client** (`connect()`) — Quick Connect: no automatic reconnection. QC codes are single-use, so a dropped connection is fatal. The peer surfaces the error via `onUnhandledError`.

**Daemon** (`listen()`): reconnects automatically with exponential backoff (1s–30s). A fresh presence token is fetched via the API key on each attempt.

User-provided policy values override the defaults in both cases.

## Trust policy

`connect()` accepts a `trustPolicy` option (default `"auto"`):

| Policy     | Behavior                                                                              |
| ---------- | ------------------------------------------------------------------------------------- |
| `"auto"`   | Pins on first connection; silently re-pins on identity change (TOFR, not strict TOFU) |
| `"prompt"` | Calls `onFirstConnection` / `onIdentityMismatch` — both callbacks required            |
| `"strict"` | Rejects any identity mismatch with an error                                           |

`"auto"` is appropriate when `api.sideband.cloud` is trusted as the daemon identity authority (daemon registered via API key). Use `"prompt"` or `"strict"` when daemon key compromise is a concern.

```ts
const peer = connect({
  daemonId: "d_abc123",
  getAccessToken: () => auth.getSessionToken(),
  identityKeyStore: store,
  trustPolicy: "prompt",
  onFirstConnection: async ({ fingerprint }) =>
    confirm(`Trust daemon ${fingerprint}?`),
  onIdentityMismatch: async ({ expectedFingerprint, receivedFingerprint }) =>
    confirm(
      `Daemon key changed.\nExpected: ${expectedFingerprint}\nGot: ${receivedFingerprint}\nTrust?`,
    ),
});
```

## Error handling

API errors (relay session fetch or presence token renewal) are classified before any retry:

| HTTP status       | Classification                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| 400, 401, 403     | Fatal — bad request or invalid credentials; peer / server stops immediately                          |
| 404               | Fatal — daemon not registered (or QC code not found)                                                 |
| 409               | Fatal in QC mode (daemon offline, code consumed); retryable in account mode (ghost-socket collision) |
| 429, 5xx, network | Retryable — exponential backoff                                                                      |

The SDK does not refresh user access tokens. If `getAccessToken()` consistently returns an invalid token, the peer retries until `retryPolicy.maxAttempts` is exhausted.

Fatal credential failures (`CloudApiError` with status 401/403/404/400) are surfaced directly — both `listen()` rejection and `connect()`'s `onUnhandledError` receive the `CloudApiError` instance. Transient errors that become terminal via `maxAttempts` are wrapped in `PeerError` to signal that terminality came from the retry policy.

```ts
import { CloudApiError, PeerError, PeerErrorCode } from "@sideband/cloud";

// listen(): await the promise and catch directly
try {
  const server = await listen({ ... });
} catch (err) {
  if (err instanceof CloudApiError) {
    console.error("Bad credentials or config:", err.status, err.message);
  }
}

// connect(): use onUnhandledError
const peer = connect({
  ...
  onUnhandledError(err) {
    if (err instanceof CloudApiError) {
      // Fatal credential failure (401/403/404) or config mismatch (400)
    } else if (err instanceof PeerError) {
      // Terminal: retries exhausted or peer closed
    }
  },
});
```

## License

Apache-2.0
