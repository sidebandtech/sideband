---
url: /protocols/rpc/behavior.md
---
# RPC Behavior

> **Authority**: Primary (Normative)\
> **Purpose**: Request/response semantics, timeouts, correlation, and retry guidance.

## Request/Response Lifecycle

1. Client sends `RpcRequest` with unique `cid` (correlation ID)
2. Server processes request
3. Server sends `RpcSuccess` or `RpcError` with matching `cid`

## Correlation

RPC correlation uses `cid` (correlation ID), not SBP `frameId`:

* `cid` in requests is the sending frame's `frameId`
* `cid` in responses matches the original request's `cid`
* Runtime matches on `cid`, not `frameId`

This enables relays, proxies, and fan-out without wire format changes. See ADR-010.

## Timeouts

Implementations SHOULD:

* Set request timeout of 30 seconds by default
* Allow per-method timeout configuration
* Return `RpcError` with code 1053 (Timeout) on expiry

Implementations MUST:

* Not assume responses arrive in request order
* Handle responses after timeout gracefully (discard)

## Retry Guidance

Implementations MAY retry failed requests:

* On transport errors (not on application errors)
* With exponential backoff (recommended: 1s, 2s, 4s, max 30s)
* With jitter to avoid thundering herd

Implementations MUST NOT retry:

* After receiving `RpcError` (server explicitly rejected)
* Without new `cid` (would confuse correlation)

## Concurrent Requests

Multiple requests MAY be in flight simultaneously:

* Each request has unique `cid`
* Responses may arrive out of order
* Implementations SHOULD track pending requests by `cid`

## Notifications

`RpcNotification` (`t:"N"`) is fire-and-forget:

* MUST use `event/` subjects (see [envelope.md](./envelope.md#subject-namespacing))
* No `cid` (no correlation)
* No response expected
* No delivery guarantee beyond transport layer

## Transport Semantics

RpcError is request-scoped and MUST NOT trigger transport close.
