---
url: /protocols/sbp/errors.md
---
# SBP Error Model (v1)

> **Authority**: Primary (Normative)\
> **Purpose**: Error taxonomy, codes, sender/receiver contracts, and retryability for SBP.

Defines canonical error semantics for `@sideband/protocol`, independent of transport. Error frames are part of the public contract; transports MAY also surface transport-native errors (e.g. WebSocket close codes) but must map protocol failures to `ErrorFrame`.

## Error taxonomy

SBP defines error codes in the 1000–1049 range:

| Code | Name               | Semantics                                        |
| ---- | ------------------ | ------------------------------------------------ |
| 1000 | ProtocolViolation  | Generic protocol contract violation              |
| 1001 | UnsupportedVersion | Peer advertised incompatible version             |
| 1002 | InvalidFrame       | Frame structure or encoding error                |
| 1003 | UnsupportedFeature | Feature reserved or requires capability exchange |

Application errors use range 2000+. `ApplicationError` (2000) is a catch‑all; higher-level layers may define stable subcodes via metadata or payload.

See [Error Code Ownership](../architecture.md#error-code-ownership) for the full allocation table across layers.

## Error frame shape (binary)

* `ErrorFrame` (`t=3`): `code:uint16 LE`, `msgLen:uint32 LE`, `message:UTF-8`, optional opaque `details` (e.g. JSON/CBOR details).
* `id` SHOULD mirror the failing frame's `id` when correlating to a request/response; absent otherwise.
* `ts` OPTIONAL for diagnostics.

## Contract for senders

* Use the narrowest code available; avoid overloading `ApplicationError` for protocol faults.
* Message text SHOULD be short and stable enough for logs; do not leak secrets.
* On version mismatch during handshake: send `UnsupportedVersion` then close.
* On malformed input: send `InvalidFrame` with context in `message`; `details` MAY include a structured schema error.
* When closing after a fatal error, prefer sending an `ErrorFrame` before `Control:Close` unless the transport is already unusable.

## Contract for receivers

* Treat `ProtocolViolation` and `UnsupportedVersion` as fatal; close the transport after emitting diagnostics.
* `InvalidFrame` MAY be fatal or MAY trigger best-effort recovery if the frame boundary is intact; if recovery is unsafe, close.
* `UnsupportedFeature` is non-fatal; continue processing subsequent frames. The feature is valid but unavailable in this version or capability set.
* `ApplicationError` is non-fatal to the transport; the caller decides whether to retry.
* If `id` is present, route the error to the correlated request/stream; otherwise emit as connection-level fault.

## Retryability and mapping

* Retryable: typically `ApplicationError` with explicit higher-level hint; protocol spec itself is neutral.
* Non-retryable: `UnsupportedVersion`, repeated `ProtocolViolation`, structurally invalid frames.
* WebSocket mapping (guidance):
  * Close with `1002` (protocol error) for `ProtocolViolation`/`InvalidFrame`.
  * Close with `1003` (unsupported data) for `UnsupportedVersion`.
  * Preserve `ErrorFrame.message` in close reason when size allows; otherwise emit to logs only.

## Security considerations

* Size: receivers MAY cap `ErrorFrame.details` (e.g. ≤ 16 KiB) to prevent abuse.
* Untrusted text: treat `message` as untrusted; escape before surfacing in UIs.
* Rate limit: throttle repeated errors from a peer to avoid log/CPU DoS.
