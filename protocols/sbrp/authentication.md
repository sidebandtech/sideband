---
url: /protocols/sbrp/authentication.md
---
# Relay Authentication

> **Authority**: Primary (Normative)\
> **Purpose**: Token-based authentication contract between control plane and relay data plane.

## Architecture Separation

SBRP separates concerns between two planes:

| Plane             | Responsibility                                                |
| ----------------- | ------------------------------------------------------------- |
| **Control Plane** | User auth, daemon registry, session brokering, token issuance |
| **Data Plane**    | Frame routing, presence, token validation                     |

The control plane issues tokens that grant relay access: short-lived **session tokens** for clients and long-lived **presence tokens** for daemons. The relay validates tokens but NEVER issues them.

## Token Claims

Tokens are JWTs signed by the control plane. The relay MUST validate these claims:

```typescript
interface RelayTokenClaims {
  // Standard JWT claims
  iss: string; // MUST match configured issuer
  aud: string | string[]; // Relay normalizes to array; MUST contain "sideband-relay"
  exp: number; // Unix timestamp; issuer SHOULD ≤120s for clients (MUST NOT exceed 300s); daemon tokens SHOULD use TTL ≥1h
  iat: number; // Issued-at timestamp (REQUIRED; absence or non-number makes TTL check bypass via NaN)
  jti: string; // Unique token ID; issuer MUST include; relay does not validate (audit only)

  // Schema version (if present, MUST be 1; absent: accepted)
  ver?: 1;

  // Identity
  sub: string; // Principal: daemon ID (daemon tokens) or user ID (client tokens)
  role: "daemon" | "client";

  // SBRP routing
  did: string; // Daemon routing target (REQUIRED for both roles)
  sid?: string; // Session ID base64url(uint64 ≠ 0); REQUIRED for clients

  // Capabilities — relay behavior MUST be based on scp; absent treated as []; unknown scopes MUST be ignored
  scp?: string[];

  // Optional
  region?: string; // Relay region binding (hard fail if mismatch)
  lim?: { concurrent_sessions?: number }; // Effective cap; absent = plan default; if present, MUST be positive integer ≥ 1
}
```

## Capability Scopes

The `scp` claim lists capabilities granted to the token holder. Relay behavior decisions MUST be based on `scp`; no implicit defaults apply after validation.

| Scope              | Applicable Role | Description                                                                |
| ------------------ | --------------- | -------------------------------------------------------------------------- |
| `"session:create"` | client          | Client may initiate sessions (always present in client tokens)             |
| `"session:resume"` | daemon          | Daemon may resume paused sessions on reconnect (deny-by-default if absent) |

**Deny-by-default**: A daemon token without `"session:resume"` in `scp` is treated as non-resumable.

**Forward compatibility**: Unknown scopes MUST be ignored. Relay implementations MUST NOT reject tokens containing unrecognized scope strings. The relay automatically sends `Control(session_expired)` to all paired clients upon daemon reconnect, without waiting for Signal frames.

## Validation Rules

The relay MUST validate in this order:

**Phase 1 — Header** (unauthenticated, but cheap to check before signature work)

1. Extract token from Authorization header or `?token` query parameter; reject if token length > 4096 or if not exactly 3 dot-separated parts (malformed tokens → 401, not 500)
2. Decode JWT header; reject if `typ` ≠ `"sbrp-relay+jwt"` (missing or wrong value)
3. Extract `kid` from header; reject if missing

**Phase 2 — Cryptographic**

4. Verify JWT signature using JWKS from control plane (using `kid`); MUST restrict accepted algorithms to `["EdDSA"]` — prevents algorithm substitution if a non-EdDSA key enters the JWKS pool

**Phase 3 — Payload** (all claims are authenticated after this point)

5. Normalize `aud` string→array; verify it contains `"sideband-relay"`
6. Reject `iss` ≠ configured issuer
7. Reject if `iat` or `exp` is missing or not a number (prevents silent NaN bypass in TTL check)
8. Reject `exp` < current time (with ≤30s clock skew tolerance)
9. If `ver` present: reject if ≠ `1` (absent: accept, emit metric)
10. Reject if `role` is missing or not in `{"daemon","client"}`
11. Reject if `did` is missing, not a string, or empty
12. If `role === "client"`: reject if `sub` is missing, not a string, or empty; reject if `sid` is missing, not a string, empty, does not base64url-decode to exactly 8 bytes, or decodes to zero
13. If `region` claim is present: reject if it doesn't match relay's configured region
14. If `role === "client"`: reject if `exp − iat > 300` (warn if `> 120`)
15. If `scp` present: reject if not an array or if any element is not a string
16. If `lim.concurrent_sessions` present: reject if not a positive integer ≥ 1

The relay MUST NOT:

* Track `jti` values for revocation or deduplication (expiration handles token lifetime; audit logging is permitted)
* Issue tokens under any circumstances
* Disconnect established WebSocket connections due to token expiry (tokens are validated at connection time only; session lifetime is managed by application-level mechanisms)

## Key Rotation

The control plane publishes signing keys via a standard JWKS endpoint (`<issuer>/.well-known/jwks.json`).

The relay SHOULD:

* Cache JWKS for up to 5 minutes
* Refresh JWKS when encountering unknown `kid` (key ID)
* Support at least 2 concurrent keys for rotation
* Verify the selected JWK has `alg: "EdDSA"` (prevents algorithm substitution if future key types are added)

## Connection Flow

```text
┌─────────┐         ┌─────────────┐         ┌─────────┐
│ Client  │         │Control Plane│         │  Relay  │
└────┬────┘         └──────┬──────┘         └────┬────┘
     │                     │                     │
     │ request session     │                     │
     │ {daemonId}          │                     │
     ├────────────────────►│                     │
     │                     │                     │
     │ {relayUrl, token}   │                     │
     │◄────────────────────┤                     │
     │                     │                     │
     │ WSS relayUrl?token= │                     │
     ├─────────────────────┼────────────────────►│
     │                     │                     │
     │                     │      validate token │
     │                     │      pair by sid    │
     │                     │                     │
     │◄════════════════════ E2EE frames ════════►│
```

The relay endpoint is a fixed path — the routing key (`daemonId`) is derived exclusively from
validated token claims, not from the URL:

```
wss://{region}.relay.sideband.cloud?token=<jwt>
```

Token delivery:

* **Query parameter**: `?token=<jwt>` (browser WebSocket compatibility)
* **Authorization header**: `Authorization: Bearer <jwt>` (preferred for programmatic clients)

## Session Binding

For client connections, the `sid` (session ID) in the token MUST match the `SessionID` field in session-bound frames sent by the client (`0x01`, `0x03`). Note: `0x02` is daemon→client only; `0x04` (Signal) from clients is rejected as `disallowed_sender` per the main SBRP spec. Daemon presence connections (sid omitted) are exempt—they handle multiple sessions via relay-managed pairing. Relay-generated Control frames (`0x20`) and connection-scoped frames (`0x10`, `0x11`) are not subject to token sid matching.

**Session ID format:**

* Wire format: 64-bit unsigned integer (big-endian in frame header)
* JWT `sid` claim: base64url encoding of the 8-byte big-endian uint64 (no padding)
* Non-zero: the decoded uint64 MUST NOT equal 0 (i.e., not all 8 bytes are 0x00)

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
* `sub` = daemon's own ID (same as `did`)
* `sid` is omitted (presence-only connection)
* `scp`: include `"session:resume"` to enable session resumption (deny-by-default; absent = non-resumable)
* Daemon accepts incoming sessions routed by relay

**Non-resumable daemons**: When `"session:resume"` is absent from `scp`, the relay automatically sends `Control(session_expired)` to all paired clients upon daemon reconnect, without waiting for `Signal(ready)` or `Signal(close)`. This simplifies v1 implementations that don't need resumption—the daemon doesn't need to track session IDs or send per-session Signal frames on reconnect.

When a client initiates a session, the relay validates the client's session token and routes the `HandshakeInit` frame to the daemon. The daemon identifies the session via the `SessionID` field in the frame header and uses this to key per-client state. The daemon trusts the relay to have validated the client's authorization; it does not receive or verify the client's JWT token directly.
