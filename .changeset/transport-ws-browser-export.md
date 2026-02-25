---
"@sideband/transport-ws": patch
"@sideband/protocol": patch
---

Add `wsTransport` to browser entry point so bundlers targeting browser can import the unified factory from the root package path.

Previously, the `"browser"` export condition for `.` resolved to `browser.js`, which exported `browserWsTransport` and utilities but omitted `wsTransport`. Any browser-target bundle that imported `wsTransport` from `@sideband/transport-ws` (e.g. via `@sideband/peer`) would fail with a missing-export error.

`wsTransport` in the browser context always delegates to `browserWsTransport()`; the `platform` option is accepted for API parity but ignored.
