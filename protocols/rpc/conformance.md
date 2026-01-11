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

## Subject Validation

* \[ ] Subjects MUST be 1-256 UTF-8 characters
* \[ ] Subjects MUST NOT contain null bytes
* \[ ] Subjects MUST match reserved prefix (`rpc/`, `event/`, `stream/`, `app/`)

## Test Vectors

*To be added.*
