---
"@sideband/secure-relay": minor
---

Add `Backpressure` error code (0x0902) for relay-terminated slow consumers.

- `SbrpErrorCode.Backpressure` / `WireControlCode.Backpressure` added with full wire ↔ SBRP round-trip mapping.
- `DaemonOffline` reclassified as terminal: relay closes the WebSocket when a daemon is unreachable, so reconnecting is the caller's responsibility.
- `isTerminalCode` now uses a fail-safe pattern — only non-terminal exceptions are listed; any unknown/future code defaults to terminal.
- `fromWireControlCode` error message now zero-pads the hex code for consistent readability.
