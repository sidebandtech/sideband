# ADR 003: Control Frame Type Invariants

- **Date**: 2025-11-23
- **Status**: Accepted
- **Tags**: protocol, frames, type-safety
- **Relates to**: ADR 002 (naming matrix)

## Context

The four control operations (`Handshake`, `Ping`, `Pong`, `Close`) have different data semantics: Handshake requires data, Ping/Pong forbid it, Close allows it optionally. A single generic `ControlFrame` with optional `data?: Uint8Array` allows invalid states at compile time (e.g., `{op: Ping, data: [...]}`) and invites unstructured metadata creep.

## Decision

Use a **discriminated union of control frame types** (discriminated by `op`) to encode data invariants at the type level:

- `HandshakeControlFrame`: `data` is required.
- `PingControlFrame` / `PongControlFrame`: `data` is forbidden (`data?: undefined`).
- `CloseControlFrame`: `data` is optional.

The `ControlFrame` type is the union of these four variants. Factory functions (`createHandshakeFrame`, `createPingFrame`, etc.) and type guards (`isHandshakeFrame`, etc.) enforce invariants at construction and narrowing.

### Type Definitions

Each variant is a separate interface; the union prevents invalid combinations:

```ts
export interface HandshakeControlFrame {
  kind: FrameKind.Control;
  op: ControlOp.Handshake;
  data: Uint8Array; // required
}

export interface PingControlFrame {
  kind: FrameKind.Control;
  op: ControlOp.Ping;
  data?: undefined; // forbidden
}

export interface PongControlFrame {
  kind: FrameKind.Control;
  op: ControlOp.Pong;
  data?: undefined; // forbidden
}

export interface CloseControlFrame {
  kind: FrameKind.Control;
  op: ControlOp.Close;
  data?: Uint8Array; // optional
}

export type ControlFrame =
  | HandshakeControlFrame
  | PingControlFrame
  | PongControlFrame
  | CloseControlFrame;
```

### Factory Functions and Type Guards

- Factory functions (`createHandshakeFrame(data, opts)`, `createPingFrame(opts)`, `createCloseFrame(reason?, opts)`) enforce invariants at construction.
- Type guards (`isHandshakeFrame(frame)`, `isPingFrame(frame)`, etc.) enable safe narrowing downstream.

## Consequences

### Benefits

- **Compile-time correctness**: TypeScript prevents invalid combinations (e.g., `{op: Ping, data: [...]}`).
- **Self-documenting**: Type invariants are explicit; no need to read codec or comments.
- **Prevents extension creep**: Adding ad-hoc metadata to `data` is no longer tempting; new control ops require explicit enum values and types.
- **Codec exhaustiveness**: Missing a case in encode/decode raises a compiler error.
- **Wire-compatible**: No format changes.

### Trade-offs

- Four frame types instead of one (minor boilerplate).
- Callers must use factory functions; no ad-hoc object literals.

## Future Extensions

New control ops must:

1. Add an enum value to `ControlOp`.
2. Define a new interface with explicit data semantics.
3. Add the variant to the `ControlFrame` union.
4. Update codec and add factory/type guard.

Do not add unstructured data to existing control ops.
