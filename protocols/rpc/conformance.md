---
url: /protocols/rpc/conformance.md
---
# RPC Conformance

> **Authority**: Supporting (Test specification)\
> **Purpose**: Test vectors and validation checklist for RPC implementations.\
> **Status: Stub** — This document is non-authoritative until content is added.\
> See [tracking issue](https://github.com/anthropics/sideband/issues/XXX) for progress.

## Scope

This document will cover:

* Envelope encoding round-trip tests
* Subject validation tests
* Correlation matching tests
* Timeout behavior tests
* Error handling tests

## Envelope Validation

* \[ ] `RpcRequest` MUST have `t: "r"`, `m`, and `cid`
* \[ ] `RpcSuccess` MUST have `t: "R"` and `cid`
* \[ ] `RpcError` MUST have `t: "E"`, `code`, `message`, and `cid`
* \[ ] `RpcNotification` MUST have `t: "N"` and `e`

## Subject-Envelope Validation

* \[ ] `t:"r"`, `t:"R"`, `t:"E"` envelopes MUST use `rpc` channel
* \[ ] `t:"N"` envelopes MUST use `event` channel
* \[ ] Mismatched envelopes MUST be dropped (log recommended)
* \[ ] Rejection is non-fatal (continue processing subsequent frames)
* \[ ] Subject format rules are validated by SBP (see [SBP Behavior](../sbp/behavior.md#subject-namespace))

## Error Handling

* \[ ] Valid `RpcError` response MUST NOT close transport

## Test Vectors

*To be added.*
