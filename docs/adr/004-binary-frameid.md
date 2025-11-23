# ADR 004: Binary FrameId Representation

- **Date**: 2025-11-23
- **Status**: Accepted
- **Tags**: protocol, breaking-change, wire-format

## Context

Initial wire format treated `FrameId` as UTF-8 text with space-padding to 16 bytes. This created:

- **Semantic confusion**: Random bytes as text with padding/trimming logic
- **Interop fragility**: UTF-8 handling differs across runtimes
- **Entropy underutilization**: Original spec used 12 bytes, encoded as 16-char hex
- **Developer friction**: Forced string ops on opaque data; humans need hex anyway

## Decision

`FrameId` is 16 opaque bytes (128 bits) generated via `crypto.getRandomValues()`.

**Wire:** 16 raw bytes, no encoding or padding.

**Type:** `FrameId = Uint8Array & { __brand: "FrameId" }`

**Validation:** `asFrameId()` enforces exactly 16 bytes.

**Human representation:** Helpers for logs/JSON:

- `frameIdToHex(id) → string` (32-char lowercase hex)
- `frameIdFromHex(hex) → FrameId` (validates format)

## Consequences

- **Breaking wire change**: Pre-1.0, acceptable.
- **Simpler codec**: No padding/trimming logic; just read/write 16 bytes.
- **Collision safety**: 128-bit entropy is astronomically safe.
- **Clarity**: No accidental string operations on random data.
- **Consistency**: All runtimes read the same 16 bytes.
