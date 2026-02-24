# SBP Behavior & Ordering (v1)

> **Authority**: Primary (Normative)  
> **Purpose**: Runtime semantics, ordering guarantees, and delivery expectations for SBP.

Semantic guarantees and expectations that sit above the raw frame format. Applies across transports; transport-specific notes call out deviations.

## Lifecycle

- Handshake first: each peer MUST send a Handshake control frame before any Message/Ack/Error. Receiving non-handshake frames before handshake → `ProtocolViolation` then close.
- Liveness: peers MAY send `Ping`; receivers SHOULD respond with `Pong` promptly. Unanswered pings can drive transport-level timeouts.
- Close: either side MAY send `Control:Close` and then terminate the transport.

## Subject namespace

SBP defines the canonical subject namespace for `MessageFrame.subject`. Higher layers (RPC, pub/sub) interpret payloads but do not own namespace rules.

### Recognized subjects

| Subject  | Purpose                     |
| -------- | --------------------------- |
| `rpc`    | RPC request/response        |
| `event`  | Fire-and-forget events      |
| `stream` | Streaming (reserved for v2) |
| `app/*`  | Vendor-specific / custom    |

Note: `rpc`, `event`, and `stream` are exact-match channel subjects. The `app/` prefix supports arbitrary sub-paths.

Subjects MUST be non-empty UTF-8 with no NUL characters. Implementations SHOULD limit to 256 bytes; oversize subjects MAY be rejected.

### Validation

Implementations MUST validate `MessageFrame.subject` on receipt.

If the subject does not begin with a recognized prefix:

- Respond with `ErrorFrame{code=1002, message="Invalid subject namespace"}`
- Set `id` to the offending frame's `frameId`
- Continue processing (non-fatal)

If the subject uses a recognized but unsupported prefix (e.g., `stream/` in v1):

- Respond with `ErrorFrame{code=1003, message="Unsupported feature: stream/"}`
- Set `id` to the offending frame's `frameId`
- Continue processing (non-fatal)

### v1 reservations

`stream/` is reserved for v2. v1 implementations MUST reject `stream/` subjects as described above. Future capability-gated prefixes follow the same pattern.

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

## Ack Policy

Ack frames confirm receipt, not processing. Runtime implementations follow these rules:

**Default behavior**:

- Runtimes MUST NOT generate Ack frames by default

**Opt-in configuration** (`acks: "none" | "receipt"`):

- `"none"` (default): No automatic Ack generation
- `"receipt"`: Send Ack after frame validated and enqueued for delivery

**Receipt mode semantics**:

- Runtime MUST send Ack after validating frame structure and enqueuing for handler delivery
- Runtime MUST NOT wait for handler completion (that's RPC semantics)
- Ack confirms "I received and will attempt to process", not "I processed successfully"

**Interaction with RPC**:

- RPC does not require ACKs for correctness; RPC uses request/response for confirmation
- Retries and timeouts are RPC-layer behaviors (code 1103), not Ack-derived
- Applications requiring delivery guarantees should use RPC correlation

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
