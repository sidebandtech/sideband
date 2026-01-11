---
url: /protocols/sbrp/security-checklist.md
---
# Security Checklist

> **Authority**: Supporting (Non-normative)\
> **Purpose**: Auditor-facing verification checklist. Requirements are defined in [cryptography-and-wire.md](./cryptography-and-wire.md) and [state-machine.md](./state-machine.md).

This checklist summarizes security requirements from normative documents. For authoritative definitions, see the referenced specifications.

## Daemon Security

* \[ ] Generate Ed25519 identity key on first run
* \[ ] Store identity private key with 0600 permissions
* \[ ] Include daemonId in signature payload (context binding)
* \[ ] Sign every ephemeral key with identity key
* \[ ] Use transcript hash as HKDF salt
* \[ ] Generate fresh X25519 ephemeral per session
* \[ ] Use directional keys (prevent reflection)
* \[ ] Implement bitmap-based sliding window (≥64 messages)
* \[ ] Send `Signal(ready)` for sessions with retained state after reconnect
* \[ ] Verify session state integrity before sending `Signal(ready)` after reconnect
* \[ ] Send `Signal(close, reason=state_lost)` for sessions with lost state after reconnect
* \[ ] Best-effort zero ephemeral keys and shared secrets after derivation
* \[ ] Best-effort clear all key material on session close

## Client Security

* \[ ] Pin identity key on first connection (TOFU)
* \[ ] Reject connections if identity key changes
* \[ ] Verify signature using pinned key, not freshly-fetched key
* \[ ] Include daemonId in signature verification payload
* \[ ] Use same transcript hash derivation as daemon
* \[ ] Handle `Control(session_paused/resumed/pending)` state transitions
* \[ ] Handle `Control(session_expired)` by initiating full reconnect

## Relay Security

* \[ ] Implement rate limiting
* \[ ] Validate daemon ownership before routing
* \[ ] Wait for `Signal(ready)` from daemon before sending `Control(session_resumed)` to client
* \[ ] Send `Control(session_pending)` to client when daemon reconnects
* \[ ] Never log or inspect encrypted message payloads
* \[ ] Never include identifiers in Control message text
* \[ ] Respond to Ping with Pong, copying payload; never forward Ping/Pong

## Quick Connect (Optional)

* \[ ] Disabled by default; require explicit operator opt-in
* \[ ] Enforce code expiry server-side (5 min TTL)
* \[ ] Rate-limit code generation
* \[ ] Use high-entropy codes (≥128 bits)
