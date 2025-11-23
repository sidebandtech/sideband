# RPC Envelope Specification

**Date**: 2025-11-23
**References**: ADR-006, ADR-002

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

**Constraints:**

- Subject length: 1–256 characters (UTF-8)
- No null bytes (`\0`)
- Invalid subjects → `ProtocolViolation` error at runtime

## Envelope Structure

**Request** (`t: "r"`): `m` (method name), `p?` (params)
**Success Response** (`t: "R"`): `result?` (payload)
**Error Response** (`t: "E"`): `code` (number), `message` (string), `data?` (details)
**Notification** (`t: "N"`): `e` (event name), `d?` (data)

All fields except discriminant `t` and required fields are optional. Error code ranges:

- `1000–1999`: Protocol errors (framework reserved)
- `2000+`: Application errors (user-defined)

## Encoding

**JSON (v1, always available)**: UTF-8 text; undefined fields omitted for compactness.

**CBOR (v2+)**: Binary format; negotiated via handshake capability `"encoding/cbor"`. If both peers advertise it, use CBOR; otherwise fall back to JSON.

## Correlation

Responses correlate to requests via `MessageFrame.ackFrameId`: the response's `ackFrameId` field contains the request's `frameId`.

## Validation Rules

- **Subject**: Must match reserved prefixes (`rpc/`, `event/`, `stream/`, `app/`), 1–256 chars, no null bytes.
- **Request**: `t: "r"`, `m` required.
- **Response**: `t: "R"` (success) or `t: "E"` (error with `code` and `message`).
- **Notification**: `t: "N"`, `e` required.
- **Encoding**: JSON in v1; CBOR in v2+ (capability-negotiated).

Invalid envelopes → `ProtocolViolation` error at runtime.
