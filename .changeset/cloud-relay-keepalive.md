---
"@sideband/cloud": patch
---

Fix relay keepalive lifecycle on both client and daemon sides.

- **Daemon (`listen`):** add SBRP Ping every 45s in `runMux` to prevent the relay from
  closing idle daemon connections (relay sweeps at 90s; cleared in `finally` on disconnect)
- **Client (`connect`):** fix keepalive timer race — capture interval handle in a local
  `const timer` so a stale in-flight `send` failure from a previous connection cannot clear
  the active connection's timer; `terminate()` now clears explicitly before transport close
