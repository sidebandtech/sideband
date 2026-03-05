---
"@sideband/cloud": patch
---

`listen()` now returns `CloudPeerServer` with Quick Connect support

`listen()` resolves to a `CloudPeerServer` (extends `PeerServer`) that exposes
`daemonId`, `relayUrl`, and `createQuickConnect()` — eliminating the need to
track these values separately.

```ts
const server = await listen({ apiKey, identityKeyPair, onConnection });
// server.daemonId    — daemon ID from the presence token
// server.relayUrl    — relay WebSocket base URL
const qc = await server.createQuickConnect({ ttlSeconds: 300 });
// qc.code, qc.url, qc.expiresAt
```

Also exports `renewPresenceToken`, `extractDaemonIdFromToken`, and
`CloudPeerServer` from the package root, and adds a 15 s hard timeout to all
API calls to prevent hung connections.
