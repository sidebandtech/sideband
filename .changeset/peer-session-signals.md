---
"@sideband/peer": minor
"@sideband/runtime": minor
---

Add session signal handling and split `listen()` into `@sideband/peer/server`.

**Breaking:** `listen()` is no longer exported from `@sideband/peer`. Import it from the new `@sideband/peer/server` subpath instead:

```ts
// Before
import { listen } from "@sideband/peer";

// After
import { listen } from "@sideband/peer/server";
```

**New (`@sideband/peer`):** SBRP relay pause/resume signals are now propagated to the Peer SDK. `"paused"` is a first-class `PeerState`; `sessionPaused` and `sessionResumed` events fire on relay transitions. During `"paused"`: `sendRaw()` rejects with `PeerError("session_paused")`; events buffer and flush on resume; RPC calls reject or buffer per `connectionPolicy.onDisconnect`.

**New (`@sideband/runtime`):** `SessionSignal` type and optional `subscribeSignals` on `NegotiationResult`. Negotiators that return `subscribeSignals` can push relay control signals into the SDK without coupling the runtime to SBRP internals.
