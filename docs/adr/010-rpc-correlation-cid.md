# ADR 010: Explicit RPC Correlation via `cid` in the Envelope

- **Date**: 2025-11-23
- **Status**: Accepted
- **Tags**: rpc, correctness, future-proofing, layering
- **Supersedes**: Incorrect correlation text in `docs/specs/rpc-envelope.md`

## Context

The RPC envelope spec incorrectly referenced a non-existent `MessageFrame.ackFrameId` field for correlation. The attempted fix—reusing the request's `frameId` on the response—violates the invariant that **`frameId` is sender-local unique**, making multi-hop and observability impossible.

We need explicit correlation that works in single-hop, streaming, fan-out, relay, and offline scenarios.

## Decision

1. **`frameId` semantics remain pure**: sender-local unique per wire format spec. No reuse by receivers.

2. **Add explicit `cid` (correlation ID) field to the RPC envelope payload**.

   Envelope schema (inside `MessageFrame.data`):

   ```ts
   interface RpcRequest {
     t: "r";
     m: string;
     p?: unknown;
     cid: FrameId;
   }
   interface RpcSuccess {
     t: "R";
     cid: FrameId;
     result?: unknown;
   }
   interface RpcError {
     t: "E";
     cid: FrameId;
     code: number;
     message: string;
     data?: unknown;
   }
   interface RpcNotification {
     t: "N";
     e: string;
     d?: unknown;
   } // no cid
   ```

3. **Correlation model**: Requests set `cid` to their request frame's `frameId`. Responses copy that `cid` unchanged. Runtime matches on `cid`, not `frameId`.

4. **No wire format changes.** Envelope payload only; backward compatible.

## Updated Specification

See updated `docs/specs/rpc-envelope.md` for the complete envelope specification with corrected correlation section.

## Consequences

- **Streaming RPC**: Multiple responses per request (same `cid`, different `frameId`s)
- **Multi-hop / relays**: `cid` end-to-end; `frameId` hop-local
- **Observability**: `frameId` uniqueness invariant preserved
- **Future evolution**: Envelope payload can evolve independently of wire format

## Rationale

- **Layering**: Correlation is explicit in RPC envelope; `frameId` stays pure at wire layer
- **Industry-standard**: Used by NATS, CloudEvents, Kafka, gRPC
- **Minimal cost**: 16 bytes per RPC request/response
- **Minimal surface**: No new fields on frames; existing invariants preserved

## Alternatives Considered

| Alternative                         | Why Rejected                                                    |
| ----------------------------------- | --------------------------------------------------------------- |
| Reuse request `frameId` on response | Breaks sender-local uniqueness; impossible for multi-hop/relays |
| Use `AckFrame` for RPC responses    | Conflates transport ACK with app semantics                      |
| Embed correlation in subject        | Brittle; limited length; creates awkward subject names          |

## References

- `docs/specs/rpc-envelope.md` (correlation model)
- ADR-006 (RPC envelope – correlation section updated)
- ADR-002 (naming matrix)
