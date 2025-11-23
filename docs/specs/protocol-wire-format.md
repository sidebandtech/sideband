# Protocol Wire Format (v1)

Canonical on-wire contract for `@sideband/protocol`. Applies to all transports that carry Sideband frames (WS, loopback, future TCP). Values are little-endian unless stated otherwise.

## Envelope

- Version tag: `sideband/1` (see `PROTOCOL_ID`). All frames belong to this version; negotiation happens via the handshake payload, not per-frame.
- Header (fixed 2 bytes): `t` (1 byte, `FrameKind`), `flags` (1 byte; bit0 `ts`, bit1..7 reserved = 0).
- Frame ID (`id`): **16 raw bytes (128 bits) of opaque data. Always present.** Generated via cryptographic randomness. Used for request/response correlation and ACK linkage; auto-generated to simplify runtime logic. No padding, no string encoding, no trimming.
- Optional timestamp: 8-byte signed int (ms since epoch).
- Payload: type-specific body (below).

## Frame kinds

- Control (`t=0`): first byte `c` (`ControlOp`), rest `data` (opaque).
  - Handshake (`c=0`): `data` is UTF-8 JSON of `HandshakePayload` (see below). MUST be first frame both peers send.
  - Ping (`c=1`), Pong (`c=2`): no data. MAY include timestamp via `ts`.
  - Close (`c=3`): optional UTF-8 reason in `data`.
- Message (`t=1`): **A routable, identity-bearing unit of application data.** Structure: `subjectLen` (uint32 LE) + `subject` (UTF-8, routing key) + `data` (opaque bytes). `frameId` is always present for correlation; `ts` optional. Called "Message" (not "Data") because each frame is a distinct, routable entity with optional acknowledgement support—semantically closer to messaging systems than byte streams. Wire keys: `s` (subject), `b` (data).
  - **Important**: `frameId` is sender-local unique and MUST NOT be reused or copied by the receiver into outbound frames. Each peer generates its own unique `frameId` for every frame it emits. For RPC correlation, see ADR-010 (uses explicit `cid` field in the envelope payload, not `frameId`).
- Ack (`t=2`): 16-byte `ackFrameId` (opaque binary, matching a prior frame's `frameId`). No payload data.
- Error (`t=3`): `code` (uint16 LE `ErrorCode`) + `msgLen` (uint32 LE) + `message` (UTF-8) + optional `details` (opaque bytes). SHOULD set `frameId` to the failing frame's `frameId` when available.

## Handshake payload (JSON, UTF-8)

- Fields (all strings unless noted):
  - `protocol` (required) = `"sideband"`
  - `version` (required) = `"1"`
  - `peerId` (required) unique per peer
  - `caps?` string[] of advertised capabilities (e.g. `["rpc", "stream", "compression:gzip"]`)
  - `metadata?` record of extra hints; keys MUST be namespaced (`"tracing:..."`, `"vendor:..."`).
- Rules:
  - Both sides MUST send a handshake before any Message/Ack/Error frames.
  - On mismatch of `protocol` or `version`, respond with `ErrorFrame{code=UnsupportedVersion}` then close.
  - Unknown `caps`/`metadata` keys are ignored (forward-compatible).

## Required vs optional fields (v1)

- Required: header bytes, `id` (frameId, always present), frame-specific payload fields; handshake `protocol`, `version`, `peerId`, Message `subject`, Error `code` + `message`.
- Optional: `ts`, `caps`, `metadata`, message `data`, error `details`, Close reason.
- Reserved: flags bit1..7, Control ops >3, future frame kinds >3. Receivers MUST ignore reserved bits set to 0 and close on non-zero reserved bits.

## Size & limits

- Recommended maximum frame size: 1 MiB; peers MAY advertise stricter caps via `caps` or out-of-band config. Frames exceeding a peer’s limit SHOULD elicit `ErrorFrame{code=ProtocolViolation}` then close.
- Handshake payload SHOULD be ≤ 8 KiB.
- Subjects SHOULD be ≤ 256 bytes UTF-8; longer subjects are allowed but may be rejected by implementations.

## Stream semantics on the wire

- Requests/responses/events all reuse `Message` frames (`t=1`). RPC correlation is defined at the envelope layer (see RPC envelope spec): `cid` inside `MessageFrame.data` is used for request/response matching. `frameId` remains sender-local unique and is _not_ reused by receivers. See ADR-010.
- Acks (`t=2`) confirm receipt of the frame whose `frameId` matches `ackFrameId`; no cumulative acking.
- Timestamp is advisory and not part of ordering guarantees.

## Extensibility

- Additive changes (new optional fields, new `ControlOp`, new `caps` keys) are forward-compatible for v1. New mandatory fields require a new major version.
- Future alternative encodings (e.g. CBOR) must still fit this framing; `caps` SHOULD advertise `encoding:cbor` before use.

## Compatibility matrix (v1)

- Accept frames where: `t` ∈ [0..3], reserved flags clear, required fields present, `frameId` is exactly 16 bytes.
- Ignore: unknown `caps`/`metadata` keys, extra bytes in Error `details`.
- Reject/close: unsupported `protocol`/`version`, malformed lengths, unknown frame kind, reserved flag bits set, frames before handshake, invalid `frameId` length.
