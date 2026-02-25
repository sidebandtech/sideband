# Self-Hosting the Relay

This guide describes what is already decided for relay architecture and what remains implementation
work. It is intentionally operationally focused, not a protocol spec.

---

## Current Status

- Relay architecture is defined in [ADR-016](../adr/016-relay-server-design.md).
- Protocol security/trust boundaries are defined in `docs/protocols/sbrp/threat-model.md`.
- Public deployment packaging and step-by-step runbooks are not finalized yet.

---

## Relay Responsibilities

A compliant relay must:

- Accept authenticated WebSocket connections for daemon/client roles.
- Route connections deterministically by `daemonId`.
- Forward encrypted payloads opaquely (no decryption, no SBP payload inspection).
- Emit SBRP control-plane notifications for session lifecycle (`session_paused`, `session_pending`, `session_resumed`, `session_ended`).

---

## Deployment Requirements

- Public TLS endpoint reachable by browser and daemon.
- Long-lived WebSocket support.
- Stateful connection coordination per `daemonId` (for pairing and control signaling).
- Authentication service for daemon credentials and short-lived client tokens.

The reference hosted direction is Cloudflare Workers + Durable Objects.

---

## Security Baseline

- Authenticate before WebSocket upgrade.
- Keep relay stateless with respect to plaintext message content.
- Treat `daemonId` as routable metadata, not proof of authorization.
- Enforce bounded resource policies (connection limits, payload limits, rate limits).

SBRP end-to-end encryption protects confidentiality/integrity, but does not replace relay authn/z.

---

## What This Guide Will Add Next

1. Cloudflare deployment runbook (`wrangler.toml`, DO bindings, env vars).
2. Token issuance and validation model for self-hosted control planes.
3. Operational checklist (metrics, alerting, incident playbooks, upgrade strategy).

---

## See Also

- [E2EE Guide](e2ee.md)
- [ADR-016](../adr/016-relay-server-design.md)
- `docs/protocols/sbrp/threat-model.md`
- `docs/protocols/sbrp/control-codes.md`
