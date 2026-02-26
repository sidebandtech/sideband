---
"@sideband/transport-ws": patch
"@sideband/peer": patch
---

Fix iterator lock not released on early `for await` exit

Adds `iterator.return()` to `WsConnection.inbound` so that breaking out of a
`for await...of` loop (e.g. after reading the negotiation frame) clears
`_iteratorActive`, allowing a second consumer to be created without throwing
"iterator already consumed". Also sets the flag in the fast-path close handler.

Removes the `"node"` condition from the root `.` export so the subpath
`@sideband/transport-ws/node` is the canonical Node.js entry point; updates
`@sideband/peer` to import from that subpath accordingly.
