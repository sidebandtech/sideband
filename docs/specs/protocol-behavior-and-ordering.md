# Protocol Behavior & Ordering (v1)

Semantic guarantees and expectations that sit above the raw frame format. Applies across transports; transport-specific notes call out deviations.

## Lifecycle

- Handshake first: each peer MUST send a Handshake control frame before any Message/Ack/Error. Receiving non-handshake frames before handshake → `ProtocolViolation` then close.
- Liveness: peers MAY send `Ping`; receivers SHOULD respond with `Pong` promptly. Unanswered pings can drive transport-level timeouts.
- Close: either side MAY send `Control:Close` and then terminate the transport.

## Ordering and delivery

- Within a single transport stream (WebSocket or loopback), frames are delivered in send order (reliable, ordered). Transports must preserve order.
- No cross-stream ordering: when multiple transports are used concurrently, ordering is per-transport only.
- Duplicate tolerance: the protocol does not promise global exactly-once. Implementations MAY resend on reconnect; consumers SHOULD treat `Message` with the same `id` as idempotent or deduplicate at a higher layer.
- Ack semantics: `Ack.ackId` confirms receipt (not processing) of the frame whose `id` matches `ackId`. No cumulative or windowed ACKs defined in v1.
- Timestamp: informational; does not affect ordering or validity.

## Delivery expectations by transport

- Browser WS: ordered, reliable delivery; disconnects may drop in-flight frames. No backpressure signals beyond close/error.
- Node/Bun WS: same as browser; server implementations SHOULD cap message size and enforce idle timeouts.
- Memory/loopback: ordered, reliable; optional loss simulation MUST be documented by the implementation.

## State and idempotency

- Requests/responses/events share the `Message` frame; correlation (`id`) is the only built-in state tracker.
- Consumers SHOULD make request handlers idempotent per `id` when possible; retries may occur after transport drops.
- Acks are advisory; higher layers decide whether to retry or treat missing ACKs as failures.

## Security and safety

- Size limits: peers SHOULD enforce max frame size (see wire spec) and reject oversize frames with `ProtocolViolation`.
- Rate limits: implementations MAY throttle handshakes/pings/error floods; exceeding limits SHOULD close the transport.
- Integrity: no built-in MAC; rely on transport security (TLS) and higher-layer auth. Do not trust `peerId` without external verification.
- Cross-origin (browser): host apps must configure allowed origins and reject unauthorized WS upgrades; protocol itself is origin-agnostic.

## Observability

- Errors: prefer sending `ErrorFrame` before closing when feasible; log both `code` and `message`.
- Metrics: count frames by type, error codes, ping/pong latency, handshake failures.
