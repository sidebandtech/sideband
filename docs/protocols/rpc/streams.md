# RPC Streaming

> **Authority**: Reserved  
> **Purpose**: Streaming RPC semantics for v2.  
> **Status: Stub** — Reserved for v2 streaming support.

## Overview

This document is reserved for future streaming RPC semantics. v1 does not support streaming.

## Non-Goals for v1

- Server-sent events (use `event/` subject prefix instead)
- Bidirectional streaming
- Chunked responses

## Design Considerations (Future)

When implemented, streaming MAY include:

- Stream initiation and termination frames
- Backpressure signaling
- Stream-scoped correlation
- Ordered delivery within streams

_No normative specification exists at this time._
