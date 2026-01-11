---
"@sideband/runtime": minor
"@sideband/rpc": patch
"@sideband/protocol": patch
"@sideband/secure-relay": patch
---

Add SessionManager, Router, and SbpNegotiator to `@sideband/runtime`.

**SessionManager** manages connection lifecycle (idle → connecting → negotiating → active → retryWait) with automatic reconnection, configurable backoff, and pluggable negotiators. Includes `onDecodeError` hook for encrypted channels where decode failures indicate crypto issues.

**Router** handles subject-based message dispatch with validation (`rpc/`, `event/`, `stream/`, `app/` prefixes), handler registration with priority ordering, and built-in RPC envelope processing.

**SbpNegotiator** implements SBP handshake with configurable timeouts and capability exchange.

```ts
const session = createSessionManager({
  endpoint: "wss://relay.example.com",
  transportFactory: (url) => connectWebSocket(url),
  negotiator: new SbpNegotiator({ localPeerId, capabilities }),
});

const router = createRouter();
router.route("rpc/echo", async (msg, ctx) => ctx.reply({ echo: msg.data }));
```
