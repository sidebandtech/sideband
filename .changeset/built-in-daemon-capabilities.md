---
"@sideband/peer": minor
"@sideband/cloud": minor
"sideband": minor
---

Add built-in daemon capabilities: `$sideband/stats` snapshot and live subscription, `$sideband/rpc.list` / `$sideband/rpc.describe` method introspection, `--name` CLI flag, and `capabilities` + `name` fields in `$sideband/info`. Adds `RpcInterface.listMethods()` to the peer SDK. Renames `AcceptedPeer` → `ConnectedPeer` and `CloudPeerServer` → `CloudServer`.
