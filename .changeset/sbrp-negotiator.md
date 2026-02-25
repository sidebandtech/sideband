---
"@sideband/peer": minor
"@sideband/secure-relay": patch
---

Add SBRP E2EE negotiators and `@sideband/peer/sbrp` subpath export

`@sideband/peer` gains `sbrpClientNegotiator` and `sbrpDaemonNegotiator` via a new
`@sideband/peer/sbrp` entry point (requires `@sideband/secure-relay` as a peer dep).
Includes TOFU identity pinning, configurable trust policies (`auto`/`prompt`/`strict`),
ephemeral key zeroization, and an encrypted channel wrapper with injected crypto ops.

`@sideband/secure-relay` updates the SBRP handshake wire format: `HandshakeAccept`
payload grows to 128 bytes and now includes the daemon's Ed25519 identity public key
inline, removing the need for a separate identity-key frame.
