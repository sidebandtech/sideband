# Protocol Conformance Tests (v0.1 plan)

Lightweight checklist for cross-implementation compatibility. Use deterministic fixtures; avoid network in golden tests.

## Fixtures

- Frame vectors: encode/decode golden cases for each frame kind (with fixed 16-byte `frameId` values), using fixed inputs for `subject`, `body`, `message`, `ackId`, `code`.
- Handshake payloads: valid base case; invalid protocol/version; missing `peerId`; oversized metadata.
- Error cases: malformed headers (short buffer, bad lengths), invalid frameId length (not 16 bytes), reserved flag bits set, unknown frame kind, incomplete payload for each frame kind.

## Invariants to assert

- Round-trip encoding: `decode(encode(frame))` yields the same structure for all supported frames.
- Frame ID validity: `frameId` MUST be exactly 16 bytes (opaque binary). Equality checked by byte-wise comparison.
- Reserved bits: any non-zero reserved flag bit MUST throw `InvalidFrame`.
- Length guards: subject length mismatch and message length mismatch MUST throw `InvalidFrame`.
- Handshake validation: wrong protocol/version MUST throw `UnsupportedVersion`; missing required fields MUST throw `InvalidFrame`.
- Ack frame ID: must reference exactly 16 bytes from another frame's `frameId`.

## Negative fuzzing

- Feed random/oversized buffers into `decodeFrame`; expect bounded error handling (no crashes/hangs) and `InvalidFrame`.
- Bound `ErrorFrame.message` length to implementation limit; ensure rejection path is consistent.

## Transport-shared expectations

- Ordering: encoded frame sequences preserve order after decode.
- Unicode: subjects/messages are UTF-8; invalid UTF-8 MUST be rejected when decoded to string fields.
- Limits: frames exceeding configured size caps MUST yield `ProtocolViolation` and closure.
