# RPC Envelope Specification

**Date**: 2025-11-23
**References**: ADR-010 (correlation), ADR-006, ADR-002

## Overview

The RPC envelope is a canonical structure carried inside `MessageFrame.data`. It provides type-safe semantics for requests, responses, notifications, and errors without adding new frame kinds to the protocol.

Encoded as JSON (v1) or CBOR (v2+).

## Subject Namespace

All `MessageFrame.subject` values must match one of these reserved prefixes (validated at runtime):

| Prefix    | Purpose                       | Example                  |
| --------- | ----------------------------- | ------------------------ |
| `rpc/`    | RPC request/response          | `rpc/getUser`            |
| `event/`  | Fire-and-forget pub/sub event | `event/user.joined`      |
| `stream/` | Streaming (reserved for v2)   | `stream/abc123/chunk`    |
| `app/`    | Vendor-specific               | `app/com.example/mydata` |

Subjects: 1–256 UTF-8 characters, no null bytes.

## Envelope Structure

```ts
interface RpcRequest {
  t: "r";
  m: string; // method name
  p?: unknown; // params
  cid: FrameId; // request's frameId
}

interface RpcSuccess {
  t: "R";
  cid: FrameId; // matches request.cid
  result?: unknown;
}

interface RpcError {
  t: "E";
  cid: FrameId; // matches request.cid
  code: number;
  message: string;
  data?: unknown; // error details
}

interface RpcNotification {
  t: "N";
  e: string; // event name
  d?: unknown; // no cid (fire-and-forget)
}
```

Error code ranges:

- `1000–1999`: Protocol errors (framework reserved)
- `2000+`: Application errors (user-defined)

## Encoding

**JSON (v1)**: UTF-8 text, undefined fields omitted.

**CBOR (v2+)**: Negotiated via handshake capability `"encoding/cbor"`; use if both peers support it, else JSON.

## Correlation

Every frame's `frameId` is sender-local unique and MUST NOT be reused by receivers.

RPC correlation is explicit in the envelope:

- Requests set `cid` to their request frame's `frameId`
- Responses copy that `cid` unchanged
- Runtime matches on `cid`, not `frameId`

This preserves the `frameId` invariant and enables relays, proxies, and fan-out without changes to the wire format. See ADR-010.

## Validation Rules

- **Subject**: Reserved prefix (`rpc/`, `event/`, `stream/`, `app/`), 1–256 UTF-8, no nulls
- **Request**: `t: "r"`, `m` and `cid` required
- **Response**: `t: "R"` or `t: "E"` with `code`, `message`, `cid`
- **Notification**: `t: "N"`, `e` required

Invalid envelopes raise `ProtocolViolation`.
