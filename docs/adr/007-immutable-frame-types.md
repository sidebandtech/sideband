# ADR 007: Immutable Decoded Frame Types

- **Date**: 2025-11-23
- **Status**: Accepted
- **Tags**: protocol, frames, type-safety
- **Relates to**: ADR 002, ADR 003

## Context

Decoded `Frame` types are currently mutable, allowing downstream code to reassign `kind`, `subject`, `data` after `decodeFrame()`. This violates "predictable, hard-to-misuse APIs" and "correctness first" principles—frame mutation can corrupt RPC correlation, routing, and middleware state.

The protocol library is the single source of truth for wire values; decoded frames must be immutable facts.

## Decision

All public frame types and their decoded instances are deeply readonly via TypeScript's `readonly` keyword on all properties and `Readonly<Uint8Array>` for binary data. Factory functions and `decodeFrame()` return immutable variants. Internal codec may use mutable temporaries during construction.

## Consequences

- **Eliminates mutation bugs**: TypeScript prevents reassignment of any frame property or binary data at compile time.
- **Guarantees referential stability**: Middleware, RPC handlers, and routing logic can safely pass frames without fear of corruption.
- **Zero runtime cost**: `readonly` is TS-only; no performance overhead.
- **Breaking change for mutating code**: Code that reassigns frame properties will fail type check. This is intentional—correct usage never mutates decoded frames.

## Rationale

Immutability is the standard for protocol message structures across Protocol Buffers, WebRTC, and similar systems. Decoded frames represent facts from the wire and should not be reassigned downstream. This change prevents subtle bugs while maintaining full expressivity: callers that need mutable state can explicitly copy via `new Uint8Array(frame.data)`.
