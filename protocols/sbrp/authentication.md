---
url: /protocols/sbrp/authentication.md
---
# Relay Authentication

> **Authority**: Primary (Normative)\
> **Purpose**: Token-based authentication contract between control plane and relay data plane.

## Architecture Separation

SBRP separates concerns between two planes:

| Plane             | Responsibility                                                | Example Endpoint            |
| ----------------- | ------------------------------------------------------------- | --------------------------- |
| **Control Plane** | User auth, daemon registry, session brokering, token issuance | `api.sideband.cloud`        |
| **Data Plane**    | Frame routing, presence, token validation                     | `eu-1.relay.sideband.cloud` |

The control plane issues tokens that grant relay access: short-lived **session tokens** for clients and long-lived **presence tokens** for daemons. The relay validates tokens but NEVER issues them.

## Token Claims

Tokens are JWTs signed by the control plane. The relay MUST validate these claims:

```typescript
interface RelayTokenClaims {
  // Standard JWT claims
  iss: string; // MUST match configured issuer (e.g., "https://sideband.cloud")
  aud: string; // MUST be "sideband-relay"
  exp: number; // Unix timestamp; session tokens SHOULD use TTL ≤ 120s (MUST NOT exceed 300s); presence tokens SHOULD use TTL ≥ 1h
  iat: number; // Issued-at timestamp
  jti: string; // Unique token ID (for audit logging)

  // SBRP-specific claims
  sid?: string; // Session ID (base64url of uint64); REQUIRED for clients, omitted for daemons
  role: "daemon" | "client";
  did: string; // Daemon ID (REQUIRED for both roles)
  cid?: string; // Client ID (REQUIRED if role === "client")

  // Optional claims
  region?: string; // Relay region binding (hard fail if mismatch)
  res?: boolean; // Resumable (daemon only); false disables session resumption (default: true)
  scp?: string[]; // Scopes (reserved for future use, ignored in v1)
}
```

## Validation Rules

The relay MUST:

1. Verify JWT signature using JWKS from control plane
2. Reject tokens where `iss` doesn't match configured issuer
3. Reject tokens where `aud` !== `"sideband-relay"`
4. Reject tokens where `exp` < current time (with ≤30s clock skew tolerance)
5. Reject tokens where `role` is missing or invalid
6. Reject tokens where `did` is missing
7. Reject tokens where `role === "client"` and `cid` is missing
8. Reject tokens where `role === "client"` and `sid` is missing
9. If `region` claim is present, reject if it doesn't match relay's configured region

The relay MUST NOT:

* Track `jti` values for revocation or deduplication (expiration handles token lifetime; audit logging per Audit Requirements is permitted)
* Accept session tokens with TTL > 300 seconds
* Issue tokens under any circumstances
* Disconnect established WebSocket connections due to token expiry (tokens are validated at connection time only; session lifetime is managed by application-level mechanisms)

## Key Rotation

The control plane publishes signing keys via JWKS endpoint:

```text
GET https://sideband.cloud/.well-known/jwks.json
```

The relay SHOULD:

* Cache JWKS for up to 5 minutes
* Refresh JWKS when encountering unknown `kid` (key ID)
* Support at least 2 concurrent keys for rotation

## Connection Flow

```text
┌─────────┐         ┌─────────────┐         ┌─────────┐
│ Client  │         │Control Plane│         │  Relay  │
└────┬────┘         └──────┬──────┘         └────┬────┘
     │                     │                     │
     │ POST /sessions      │                     │
     │ {daemonId}          │                     │
     ├────────────────────►│                     │
     │                     │                     │
     │ {relay_url, token}  │                     │
     │◄────────────────────┤                     │
     │                     │                     │
     │ WSS /relay?token=...│                     │
     ├─────────────────────┼────────────────────►│
     │                     │                     │
     │                     │      validate token │
     │                     │      pair by sid    │
     │                     │                     │
     │◄════════════════════ E2EE frames ════════►│
```

Tokens are passed either:

* Query parameter: `wss://eu-1.relay.../relay?token=<jwt>`
* Authorization header: `Authorization: Bearer <jwt>`

## Session Binding

For client connections, the `sid` (session ID) in the token MUST match the `SessionID` field in session-bound frames sent by the client (`0x01`, `0x03`). Note: `0x02` is daemon→client only; `0x04` (Signal) from clients is rejected as `disallowed_sender` per the main SBRP spec. Daemon presence connections (sid omitted) are exempt—they handle multiple sessions via relay-managed pairing. Relay-generated Control frames (`0x20`) and connection-scoped frames (`0x10`, `0x11`) are not subject to token sid matching.

**Session ID format:**

* Wire format: 64-bit unsigned integer (big-endian in frame header)
* JWT `sid` claim: base64url encoding of the 8-byte big-endian uint64 (no padding)

```text
Token claims: { sid: "AAALOnPOL_I", role: "client", did: "d_xyz" }
                    │
                    ▼ base64url decode → 8 bytes → uint64
Frame header: SessionID = 0x00000B3A73CE2FF2
```

Session IDs MUST be non-zero for session-bound frames (HandshakeInit, HandshakeAccept, Data, Signal). Control frames use non-zero SessionID for session events, zero for connection errors. Ping and Pong frames MUST use SessionID = 0 (connection-scoped).

## Daemon Presence Tokens

Daemons connect with a long-lived presence token that has additional constraints:

* `role` = `"daemon"`
* `sid` is omitted (presence-only connection)
* `res` (optional): `false` to disable session resumption (default: `true`)
* Daemon accepts incoming sessions routed by relay

**Non-resumable daemons**: When `res: false`, the relay automatically sends `Control(session_expired)` to all paired clients upon daemon reconnect, without waiting for `Signal(ready)` or `Signal(close)`. This simplifies v1 implementations that don't need resumption—the daemon doesn't need to track session IDs or send per-session Signal frames on reconnect.

When a client initiates a session, the relay validates the client's session token and routes the `HandshakeInit` frame to the daemon. The daemon identifies the session via the `SessionID` field in the frame header and uses this to key per-client state. The daemon trusts the relay to have validated the client's authorization; it does not receive or verify the client's JWT token directly.

## Audit Requirements

For SOC2/compliance, implementations SHOULD:

* Log `jti` for all token validations (success and failure)
* Log session creation/termination with `sid`, `did`, `cid`
* Retain logs for configured retention period
* Never log token values or session content
