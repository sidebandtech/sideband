# Sideband Relay Protocol Compliance Checklist

Use this checklist to verify conformance with `secure-relay-protocol.md`. Items tagged MUST/SHOULD mirror normative requirements.

## Common Crypto (Client + Daemon)

- [ ] MUST use Ed25519 for daemon identity and X25519 for ephemeral key exchange.
- [ ] MUST sign handshake payload `SHA256("sbrp-v1-handshake" || daemonId || clientPublicKey || daemonPublicKey)`.
- [ ] MUST compute transcript hash `SHA256("sbrp-v1-transcript" || daemonId || clientPublicKey || daemonPublicKey || signature)` and use it as HKDF-SHA256 salt.
- [ ] MUST set HKDF `info` to the constant `"sbrp-session-keys"` and `len = 64`.
- [ ] MUST derive directional keys `clientToDaemon` and `daemonToClient`.
- [ ] MUST build nonce as 12 bytes: 4-byte direction constant + 8-byte big-endian seq.
- [ ] MUST start sequence numbers at 0 and increment per message per direction.
- [ ] MUST reject messages outside the replay window; MUST use bitmap window >= 64 and SHOULD use >= 128.
- [ ] MUST preserve sequence state on resume without handshake; if lost, MUST force full handshake.

## Client (UI)

- [ ] MUST pin daemon identity public key on first connection (TOFU).
- [ ] MUST persist pins across page reloads (for browser clients); SHOULD survive application restarts.
- [ ] MUST abort on identity mismatch with `identity_key_changed` and require explicit user approval to accept new key.
- [ ] MUST present both stored and new fingerprints on `identity_key_changed`.
- [ ] MUST verify daemon signature using pinned identity key, not relay-provided key.
- [ ] MUST perform a full handshake on client reconnect (new ephemeral keys).
- [ ] SHOULD warn when storage is unavailable or ephemeral (private/incognito).

## Daemon (Agent)

- [ ] MUST generate and persist a long-lived Ed25519 identity keypair; register public key with relay.
- [ ] MUST sign its ephemeral X25519 public key in `handshake.accept`.
- [ ] MUST maintain per-client session state (keys, seq, replay window) independently.
- [ ] MUST resume with the same keys and sequence state if relay session is resumed.
- [ ] MUST re-handshake if sequence state is lost before resuming encrypted traffic.
- [ ] MUST NOT resume a session after process restart or loss of volatile memory.
- [ ] SHOULD store identity keys with restrictive permissions (e.g., 0600).
- [ ] SHOULD best-effort zeroize ephemeral key material after use.

## Relay

- [ ] MUST authenticate user sessions and daemon API keys.
- [ ] MUST enforce user → daemon ownership on connections.
- [ ] MUST provide daemon identity public keys to clients for TOFU pinning.
- [ ] MUST forward handshake and encrypted messages without modification or inspection.
- [ ] SHOULD rate-limit connections and message throughput.
- [ ] If reconnection grace is implemented, MUST pause routing when daemon disconnects and resume only within the grace window; otherwise MUST require a new handshake.

## Optional: Quick Connect

- [ ] MUST issue time-limited codes (5 minutes) and perform normal E2EE handshake.
- [ ] SHOULD warn that Quick Connect provides reduced authentication guarantees.
