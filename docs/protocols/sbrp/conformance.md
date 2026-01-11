# SBRP Conformance Checklist

> **Authority**: Supporting (Test specification)  
> **Purpose**: Testable invariants and verification checklist for SBRP implementations.

Use this checklist to verify conformance with SBRP. Requirements reference:

- [cryptography-and-wire.md](./cryptography-and-wire.md) — crypto primitives and wire format
- [state-machine.md](./state-machine.md) — state transitions and control semantics
- [control-codes.md](./control-codes.md) — code values
- [authentication.md](./authentication.md) — token validation

Items tagged MUST/SHOULD mirror normative requirements.

## Common Crypto (Client + Daemon)

- [ ] MUST use Ed25519 for daemon identity and X25519 for ephemeral key exchange.
- [ ] MUST UTF-8 encode context strings and `daemonId` (no BOM, no length prefix) before concatenation in signature/transcript payloads.
- [ ] MUST sign handshake payload `SHA256("sbrp-v1-handshake" || daemonId || clientEphemeralPublicKey || daemonEphemeralPublicKey)`.
- [ ] MUST compute transcript hash `SHA256("sbrp-v1-transcript" || daemonId || clientEphemeralPublicKey || daemonEphemeralPublicKey || signature)` and use it as HKDF-SHA256 salt.
- [ ] MUST set HKDF `info` to the constant `"sbrp-session-keys"` and `len = 64`.
- [ ] MUST derive directional keys `clientToDaemon` and `daemonToClient`.
- [ ] MUST build nonce as 12 bytes: 4-byte direction constant + 8-byte big-endian seq.
- [ ] MUST use empty AAD for ChaCha20-Poly1305 encryption.
- [ ] MUST start sequence numbers at 0 and increment per message per direction.
- [ ] MUST reject messages outside the replay window; MUST use bitmap window >= 64 and SHOULD use >= 128.
- [ ] MUST handle large sequence jumps in O(1) by resetting the bitmap rather than iterating.
- [ ] MUST preserve sequence state on resume without handshake; if lost, MUST force full handshake.

## Client (UI)

- [ ] MUST pin daemon identity public key on first successful handshake (TOFU); do not pin before signature verification succeeds.
- [ ] MUST persist pins across page reloads (for browser clients); SHOULD survive application restarts.
- [ ] MUST abort on identity mismatch with `identity_key_changed` and require explicit user approval to accept new key.
- [ ] MUST present both stored and new fingerprints on `identity_key_changed`.
- [ ] MUST verify daemon signature using pinned identity key, not relay-provided key.
- [ ] MUST obtain a new session token (new `sid`) on client reconnect; no session resumption.
- [ ] MUST perform a full handshake on client reconnect (new ephemeral keys).
- [ ] MUST handle `Control(session_paused)` by suspending encrypted sends.
- [ ] MUST handle `Control(session_pending)` to indicate daemon reconnected, awaiting readiness.
- [ ] MUST handle `Control(session_resumed)` by resuming with retained session state.
- [ ] MUST handle `Control(session_expired)` by initiating full reconnect with new handshake.
- [ ] SHOULD complete handshake within 30 seconds of WebSocket open; MUST abort with `handshake_failed` on timeout.
- [ ] SHOULD warn when storage is unavailable or ephemeral (private/incognito).
- [ ] MUST NOT parse Control message text for behavioral decisions; use only the code.

## Daemon (Agent)

- [ ] MUST generate and persist a long-lived Ed25519 identity keypair; register public key with control plane.
- [ ] MUST sign its ephemeral X25519 public key in `HandshakeAccept`.
- [ ] MUST sign with the identity key currently registered as active at the control plane.
- [ ] MUST maintain per-client session state (keys, seq, replay window) independently.
- [ ] MUST handle `Control(session_ended)` by cleaning up per-session state (keys, seq counters, replay window).
- [ ] SHOULD complete handshake within 30 seconds of receiving `HandshakeInit`; MUST abort with `handshake_failed` on timeout.
- [ ] SHOULD store identity keys with restrictive permissions (e.g., 0600).
- [ ] SHOULD best-effort zeroize ephemeral key material after use.

### Session Resumption (resumable daemons only)

Daemons with `res: false` in their presence token skip this section—the relay handles session cleanup automatically on reconnect.

- [ ] MUST resume with the same keys and sequence state if relay session is resumed.
- [ ] MUST send `Signal(ready)` for sessions with retained state after reconnect.
- [ ] MUST verify session state integrity before sending `Signal(ready)`; if any component is missing, malformed, or inconsistent, MUST send `Signal(close, reason=state_lost)` instead.
- [ ] MUST send `Signal(close)` for all sessions after process restart or loss of volatile memory.

### Signal Frame Requirements

- [ ] MUST use 2-byte payload: signal code (1B) + reason code (1B).
- [ ] MUST use signal code `0x00` for ready, `0x01` for close.
- [ ] SHOULD use reason code `0x00` (`none`) for ready signal.
- [ ] MUST use appropriate reason code for close: `0x00` none, `0x01` state_lost, `0x02` shutdown, `0x03` policy, `0x04` error.

## Relay

- [ ] MUST validate relay tokens issued by the control plane (not authenticate directly).
- [ ] MUST enforce token claims: role, daemonId, expiration; sessionId required for client tokens only.
- [ ] MUST enforce user → daemon ownership via token claims.
- [ ] MUST forward endpoint frames (`0x01`, `0x02`, `0x03`) without modification or inspection.
- [ ] MUST handle `Signal(ready)` from daemon: send `Control(session_resumed)` to client, resume routing.
- [ ] MUST handle `Signal(close)` from daemon: send `Control(session_expired)` to client, close session pairing.
- [ ] MUST reject `Signal` (`0x04`) received from clients as `disallowed_sender` if header is parseable.
- [ ] MUST reject `Control` (`0x20`) received from peers as `disallowed_sender` if header is parseable.
- [ ] MUST close WebSocket with `Control(malformed_frame, SessionID=0)` if frame header is malformed or truncated.
- [ ] MUST rate-limit connections and message throughput per §8.6.
- [ ] MUST send `Control(session_paused)` to client when daemon disconnects.
- [ ] MUST send `Control(session_pending)` to client when resumable daemon reconnects within grace period.
- [ ] MUST NOT send `Control(session_resumed)` until receiving `Signal(ready)` from daemon (resumable daemons only).
- [ ] MUST send `Control(session_expired)` to client and close WebSocket when grace window expires.
- [ ] MUST send `Control(session_ended)` to daemon when client disconnects, if daemon is connected; silently tear down pairing if daemon is offline.
- [ ] MUST validate JWT tokens: issuer, audience (`sideband-relay`), expiration, and role/daemon/client claims per Appendix C.
- [ ] MUST verify `sid` in token (base64url-decoded to uint64) matches frame header SessionID for client connections.
- [ ] MUST NOT generate Control frames that leak information derived from encrypted payloads.
- [ ] MUST NOT include identifiers (daemonId, clientId, sessionId, tokens) in Control message text.
- [ ] MUST send `Control(session_expired)` to all paired clients immediately when non-resumable daemon (`res: false`) reconnects.
- [ ] SHOULD send `Control(internal_error, SessionID=0)` and close WebSocket on unrecoverable internal failures.

### Frame Validation Order

- [ ] MUST validate frames in order per §13.3: header parse → payload size → frame type → SessionID validity → frame direction.
- [ ] MUST use `invalid_session_id` (SID=0) if session-bound frame has SessionID=0 or Ping/Pong has non-zero SessionID.
- [ ] MUST use `disallowed_sender` with header's SessionID only after SessionID validity passes.
- [ ] MUST use `rate_limited` with SID=0 (connection-level per §8.6).

### Keepalive (Ping/Pong)

- [ ] MUST handle Ping (`0x10`) locally: respond with Pong (`0x11`) copying payload.
- [ ] MUST NOT forward Ping or Pong frames.
- [ ] Ping/Pong frames MUST have SessionID = 0 (connection-scoped).
- [ ] Ping payload MUST be 0-8 bytes; relay MUST reject larger payloads.
- [ ] MAY send Ping to endpoints to detect dead connections.

## Control Code Compliance

### Wire Codes (Relay → Endpoint)

- [ ] MUST use code ranges per §14.1: 0x01xx auth, 0x02xx routing, 0x03xx session, 0x04xx wire, 0x06xx internal, 0x09xx rate, 0x10xx state.
- [ ] MUST use correct SessionID scope per §14.1 SID column: 0 for connection-level errors, non-zero for session-specific events.
- [ ] Terminal codes (T in §14.1) MUST close WebSocket after sending.
- [ ] Non-terminal codes (N in §14.1) MUST NOT close WebSocket.

### Endpoint Codes (SDK Only)

- [ ] MUST use 0xExxx range for SDK-only codes (never transmitted on wire).
- [ ] `identity_key_changed` (0xE001) MUST trigger abort and user confirmation flow.
- [ ] `handshake_failed` (0xE002) MUST trigger connection close.
- [ ] `handshake_timeout` (0xE003) MUST trigger connection close after 30s.
- [ ] `decrypt_failed` (0xE004) MUST trigger connection close.
- [ ] `sequence_error` (0xE005) MUST reject message; MAY trigger connection close.

## Optional: Quick Connect (Control Plane)

- [ ] MUST be disabled by default; require explicit operator opt-in for production deployments.
- [ ] MUST issue time-limited codes (≤5 minutes) and enforce expiry server-side.
- [ ] MUST rate-limit code generation (e.g., max 10 per minute per daemon).
- [ ] MUST enforce TTL eviction; SHOULD enforce one-time use; MAY use durable storage with TTL for HA.
- [ ] MUST issue standard relay session token after code validation; relay sees no difference.
- [ ] Client MUST perform normal E2EE handshake with signature verification.
- [ ] SHOULD warn that Quick Connect provides reduced authentication guarantees.
