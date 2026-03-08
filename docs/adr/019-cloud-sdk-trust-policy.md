# ADR-019: Cloud SDK Trust Policy Defaults

- **Date**: 2026-03-08
- **Status**: Accepted
- **Affects**: SDK

## Context

`@sideband/cloud`'s `connect()` wraps `relayClientNegotiator`, which requires a `trustPolicy`
telling it how to handle first connections and identity mismatches. Three policies exist:

- `"auto"` — accept and pin on first connection; silently re-pin on identity mismatch (TOFR)
- `"pinned-only"` — require a pre-existing pin; hard-reject on mismatch or if the store is empty
- `"prompt"` — invoke caller-provided callbacks on first connection and on mismatch (full TOFU)

The cloud relay authenticates daemons at registration time via API key — the control plane holds
the daemon's `identityPublicKey` from `daemon.register`. A caller connecting via `quickConnectCode`
has an additional trust proof: the QC code itself proves the operator intentionally shared access.

## Decision

**Default: `"auto"` for both auth paths.**

- **Quick Connect**: `"auto"` is correct. The QC code IS the out-of-band trust proof —
  prompting for a fingerprint immediately after entry adds friction without security benefit.
  On identity mismatch, re-pinning is intentional: a fresh QC code proves the operator
  regenerated access, covering the common "wiped `~/.sideband/`" case.

- **Account path**: `"auto"` is a pragmatic interim default. The intended future default is
  `"pinned-only"` verified against a control-plane-provided `expectedFingerprint` from
  `daemon.listAccessible`. That fingerprint is not yet plumbed through the current API, so
  `"pinned-only"` would reject first-time account connections against an empty store.
  `"auto"` keeps the account path functional until `expectedFingerprint` is available.

The relay's API key authentication provides a meaningful baseline: only registered daemons can
receive SBRP sessions. `"auto"` adds TOFR (Trust On First Registration) on top — weaker than
strict TOFU but not unconditional trust.

**Future direction**: when `daemon.listAccessible` provides `identityPublicKey`, the account
path will default to `"pinned-only"` using the CP-provided fingerprint — silent verification
with strong identity guarantees. A key-rotation fallback (prompt on mismatch) will handle the
`~/.sideband/` wipe case. When that lands, this ADR should be superseded.

**Callback no-op rule**: `onFirstConnection` and `onIdentityMismatch` are accepted by the
type system for all policies but only invoked when `trustPolicy === "prompt"`. Passing them
with `"auto"` or `"pinned-only"` has no effect.

## Invariants

- `"pinned-only"` MUST NOT be used as a default without a pre-populated identity store or
  a CP-provided expected fingerprint — it rejects immediately on an empty store.
- Callbacks MUST be required at the type level when `trustPolicy: "prompt"` (enforced via
  discriminated union in `ConnectOptions`).
- The trust policy used by `CloudClientNegotiator.negotiate()` is always the caller-supplied
  value or the default computed at negotiate-time — never cached across reconnects.

## Alternatives Considered

**Auth-mode-aware default (QC → `"auto"`, account → `"pinned-only"`)**
Rejected: `"pinned-only"` fails on first account connection — the pin is established by the
first successful connection, so an empty store at that point silently breaks the happy path.

**Default to `"prompt"` on account path**
Rejected: the type system mandates callbacks for `"prompt"` mode, forcing every caller to
supply them even without interactive trust management intent.

## References

- `packages/cloud/src/connect.ts` — `ConnectOptions`, `CloudClientNegotiator.negotiate()`
- `packages/peer/src/negotiator/client.ts` — `relayClientNegotiator`, `trustPolicy` implementation
- ADR-017: Cloud SDK Design (auth modes, `getConnectionParams`)
