---
url: /protocols/rpc/envelope.md
---
# RPC Envelope Specification

> **Authority**: Primary (Normative)\
> **Purpose**: Defines envelope structure, subject namespacing, and validation rules for RPC.

**Date**: 2025-11-23
**References**: [Protocol Architecture](../architecture.md), ADR-010, ADR-006, ADR-002

## Overview

The RPC envelope is a canonical structure carried inside `MessageFrame.data`. It provides type-safe semantics for requests, responses, notifications, and errors without adding new frame kinds to the protocol.

Encoded as JSON (v1) or CBOR (v2+).

## Subject Namespace

RPC envelopes require `MessageFrame.subject` to begin with `rpc/`. Other prefixes (`event/`, `stream/`, `app/`) are handled by other subsystems and are outside RPC scope.

See [SBP Behavior](../sbp/behavior.md#subject-namespace) for the canonical namespace table and validation rules.

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

RPC defines error codes in the 1050–1099 range:

| Code | Name                | Semantics                                       |
| ---- | ------------------- | ----------------------------------------------- |
| 1050 | InvalidEnvelope     | Envelope structure or encoding error            |
| 1051 | UnsupportedMethod   | Method not recognized by handler                |
| 1052 | CorrelationMismatch | Response cid does not match any pending request |
| 1053 | Timeout             | Request timed out waiting for response          |

Application errors use range 2000+ (user-defined).

See [Error Code Ownership](../architecture.md#error-code-ownership) for the full allocation table across layers.

## Encoding

**JSON (v1)**: UTF-8 text, undefined fields omitted.

**CBOR (v2+)**: Negotiated via handshake capability `"encoding/cbor"`; use if both peers support it, else JSON.

## Correlation

Every frame's `frameId` is sender-local unique and MUST NOT be reused by receivers.

RPC correlation is explicit in the envelope:

* Requests set `cid` to their request frame's `frameId`
* Responses copy that `cid` unchanged
* Runtime matches on `cid`, not `frameId`

This preserves the `frameId` invariant and enables relays, proxies, and fan-out without changes to the wire format. See ADR-010.

## Validation Rules

* **Subject**: Must begin with `rpc/` (namespace validation handled by SBP)
* **Request**: `t: "r"`, `m` and `cid` required
* **Response**: `t: "R"` or `t: "E"` with `code`, `message`, `cid`
* **Notification**: `t: "N"`, `e` required

Unroutable envelope failures escalate to `ErrorFrame` per `architecture.md#error-scope-and-transport-authority`.
