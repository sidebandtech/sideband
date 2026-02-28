---
"@sideband/cloud": patch
---

Fix tRPC response parsing — correct `TrpcResponse<T>` envelope shape (`data: T` not `data: { json: T }`, `error.message`/`error.data.code` not `error.json`).
