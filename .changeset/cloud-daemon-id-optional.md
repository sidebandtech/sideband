---
"@sideband/cloud": minor
"@sideband/peer": minor
"@sideband/protocol": minor
"@sideband/rpc": minor
"@sideband/runtime": minor
"@sideband/secure-relay": minor
"@sideband/transport": minor
"@sideband/transport-ws": minor
---

Make `daemonId` optional in `listen()` — extracted from the presence token's `did` claim automatically; mismatch with a provided value throws immediately.

Add `AbortSignal` support to `fetchRelaySession` and `renewPresenceToken`.

Export `CloudApiError` from the main entry point.

Fix SBRP application-level Ping/Pong handling, `close()` now awaits full loop drain, and add jitter + backoff credit for stable connections.
