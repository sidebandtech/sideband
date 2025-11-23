# ADR 008: Enforce Reserved Subject Namespace at the Protocol Layer

- **Date**: 2025-11-23
- **Status**: Accepted
- **Tags**: protocol, validation, correctness, conformance

## Context

ADR-006 mandates that all `MessageFrame.subject` values start with one of four reserved prefixes: `rpc/`, `event/`, `stream/`, or `app/`.

The protocol layer did not enforce this contract. The wire codec accepted any string; validation only existed in `@sideband/rpc` (optional). This violated ADR-006 and the principle of correctness-first design.

## Decision

Move subject validation into `@sideband/protocol` — the only package owning the wire-format contract.

1. **Add branded `Subject` type**: Prevents accidental misuse at the TypeScript level.

2. **Add `asSubject()` validator**: Runtime validation enforcing:
   - 1–256 UTF-8 bytes (measured correctly, not code units)
   - Reserved prefix (`rpc/`, `event/`, `stream/`, or `app/`)
   - No null bytes or empty strings
   - Throws `ProtocolError(ProtocolViolation)` on violation

3. **Update `MessageFrame.subject`**: Change from `string` to `Subject` type.

4. **Add `createMessageFrame()` factory**: User-facing API that validates subject at construction.

5. **Update `decodeFrame()`**: Validate subject on wire decode. Invalid subjects → fatal protocol violation → connection close.

6. **Update RPC layer**: Re-export protocol validator as `asRpcSubject()`. Remove duplicate validation. Keep `ProtocolViolation` class for backwards compatibility (extends `ProtocolError`).

## Technical Details

**UTF-8 byte length**: Validator measures via `TextEncoder` (not JavaScript `.length`, which counts code units). Correctly handles multi-byte characters.

**Prefix list extensibility**: Stored as const array, enabling future extensions (e.g., `signal/`) without API breakage. Update `RESERVED_SUBJECT_PREFIXES`, release minor version.

**Error semantics**: Invalid subjects are fatal. On send: synchronous throw. On receive: `ProtocolError(ProtocolViolation)` → `ErrorFrame` → close connection.

## Consequences

| Area                | Impact                                                                             |
| ------------------- | ---------------------------------------------------------------------------------- |
| **Correctness**     | Every frame on the wire provably conforms to ADR-006. No bypass paths.             |
| **API safety**      | Invalid subjects rejected at construction time, not silently sent or received.     |
| **Breaking change** | Pre-1.0 acceptable. Raw `MessageFrame` construction will fail type-check or throw. |
| **Performance**     | Negligible: one `TextEncoder` + prefix check per message.                          |

## Alternatives Considered and Rejected

- **Validate only in RPC**: Higher layers bypass; transports/tools emit invalid frames.
- **Validate only on send**: Malicious peers can flood with invalid subjects (DoS).
- **Validate only on decode**: Invalid frames constructed internally; bugs in middlewares.
- **Configurable prefix set**: Foot-gun; violates "one obvious way" principle.
