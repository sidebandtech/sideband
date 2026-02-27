# @sideband/cloud

High-level SDK for [relay.sideband.cloud](https://relay.sideband.cloud). Wraps `@sideband/peer` and `@sideband/secure-relay` with automatic relay session management, presence token renewal, and E2EE.

## Install

```bash
bun add @sideband/cloud
```

## Quick start

### Client

```ts
import { connect, createMemoryIdentityKeyStore } from "@sideband/cloud";

const peer = connect({
  daemonId: "d_abc123",
  getAccessToken: () => auth.getSessionToken(), // called on each connect attempt
  identityKeyStore: createMemoryIdentityKeyStore(),
});

peer.rpc.handle("push", handlePush); // register before connection completes
await peer.whenReady();
const result = await peer.rpc.call("ping");
```

### Daemon

```ts
import { listen, generateIdentityKeyPair } from "@sideband/cloud";

const server = await listen({
  daemonId: process.env.SIDEBAND_DAEMON_ID,
  apiKey: process.env.SIDEBAND_API_KEY,
  identityKeyPair: await loadOrCreateIdentityKeyPair(),
  onConnection(peer) {
    peer.rpc.handle("ping", () => "pong");
  },
});
```

`listen()` makes an outbound WebSocket to the relay (not a local port bind) and demultiplexes incoming SBRP sessions from multiple clients over it. Resolves once the first relay connection succeeds — transient failures (network unavailable, 502, DNS) are retried with exponential backoff before resolving. Only fatal API errors (401/403/404) reject immediately.

Pass a `signal` to cancel startup before the first connect. Use `server.close()` to stop a running daemon. Override `relayUrl` for staging or self-hosted relays.

**Daemon identity key**: generate once and persist securely. Regenerating causes a TOFU mismatch for all clients.

## Reconnection

**Client** (`connect()`): auto-reconnects with cloud-appropriate defaults:

- `connectionPolicy.onDisconnect: "pause"` — RPCs buffer across reconnects, flushed on re-activation
- `retryPolicy.mode: "on-error"` — reconnect automatically on transport drops

A fresh relay session is fetched from `api.sideband.cloud` on every connect attempt — relay rejects reused session IDs with 409.

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

| HTTP status       | Classification                                                              |
| ----------------- | --------------------------------------------------------------------------- |
| 400, 401, 403     | Fatal — bad request or invalid credentials; peer / server stops immediately |
| 404               | Fatal — daemon not registered                                               |
| 429, 5xx, network | Retryable — exponential backoff                                             |

The SDK does not refresh user access tokens. If `getAccessToken()` consistently returns an invalid token, the peer retries until `retryPolicy.maxAttempts` is exhausted.

```ts
import { PeerError, PeerErrorCode } from "@sideband/cloud";

peer.on("error", (err) => {
  if (err instanceof PeerError) {
    // err.code — see PeerErrorCode
  }
});
```

## License

Apache-2.0
