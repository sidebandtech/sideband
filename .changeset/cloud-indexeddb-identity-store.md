---
"@sideband/cloud": patch
---

Add `createIndexedDBIdentityKeyStore()` for browser-persistent TOFU pins

Browser-backed `IdentityKeyStore` that persists daemon identity keys in
IndexedDB across page reloads. Lazy-initialized (safe to import in Node),
auto-recovers on `versionchange` or open errors, and defensively copies
all key material.
