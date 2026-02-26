---
"@sideband/peer": minor
---

Exhaustive `classifySbrpError` switch and `ChannelCrypto` rename.

**Breaking:** `ChannelCrypto.clear()` renamed to `ChannelCrypto.zeroize()` — update any custom `createSbrpChannel` callers.

- `classifySbrpError` rewritten as an exhaustive switch over `SbrpErrorCode`; adding a new code without a case is now a compile-time error.
- `Backpressure`, `InternalError`, `DaemonOffline`, `RateLimited`, and session-state transitions (`SessionPaused`, `SessionResumed`, `SessionEnded`, `SessionPending`) are now explicitly classified as retryable.
