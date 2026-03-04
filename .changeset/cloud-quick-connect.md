---
"@sideband/cloud": patch
---

Add Quick Connect auth mode to `connect()`

`connect()` now accepts a `quickConnectCode` option as a one-shot bootstrap
path. The code is redeemed on the first connect attempt (single-use) and the
resolved `daemonId` is used for the SBRP handshake. Because the code is
consumed on use, the peer terminates fatally on disconnect — use the account
path (`daemonId` + `getAccessToken`) for persistent, reconnectable sessions.
