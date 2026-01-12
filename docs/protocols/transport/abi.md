# Transport ABI

> **Authority**: Primary (Normative)
> **Purpose**: Extended semantics for the `TransportConnection` interface
> **See also**: ADR-005, transport/errors.md, transport/websocket.md

This document extends ADR-005 with normative behavioral semantics for transport implementations. ADR-005 defines the interface shape; this document specifies runtime behavior.

## 1. Connection Lifecycle States

### 1.1 State Type

```typescript
type ConnectionState = "connecting" | "open" | "closing" | "closed";
```

### 1.2 Interface Extensions

```typescript
interface TransportConnection {
  /** Current connection state. */
  readonly state: ConnectionState;

  /**
   * Promise that resolves when the connection closes.
   * MUST resolve (not reject) regardless of close reason.
   */
  readonly closed: Promise<CloseInfo>;

  // ... existing members from ADR-005
}

interface CloseInfo {
  /** True if closed via normal close handshake. */
  wasClean: boolean;
  /** WebSocket close code, if available. */
  code?: number;
  /** Human-readable close reason. */
  reason?: string;
  /** Optional; present when the close was abnormal or carries error context. */
  error?: TransportError;
}
```

### 1.3 State Transitions

```text
connect() called
      |
      v
 +------------+
 | connecting | <-- Optional; MAY skip if connect() blocks until open
 +-----+------+
       | connection established
       v
  +--------+
  |  open  |
  +---+----+
      | close() called OR remote close OR error
      v
 +---------+
 | closing |
 +----+----+
      | close handshake complete OR timeout
      v
 +---------+
 | closed  |
 +---------+
```

### 1.4 Normative Rules

1. **Initial state**: A connection returned from `connect()` MUST have `state === "connecting"` or `state === "open"`.

2. **Connecting state**: Implementations MAY expose `"connecting"` state during connection establishment. If exposed, `connect()` resolves before the connection is fully open. If not exposed, `connect()` MUST NOT resolve until state is `"open"`.

3. **Send guard**: `send()` MUST reject if `state !== "open"`.

4. **Close transition**: When `close()` is called:
   - `state` MUST transition to `"closing"` synchronously
   - `send()` MUST reject immediately after this transition

5. **Closed transition**: After the close handshake completes (or times out):
   - `state` MUST transition to `"closed"`
   - `closed` promise MUST resolve with `CloseInfo`

6. **Error transition**: On transport error:
   - `state` MUST transition to `"closing"` then `"closed"`
   - `closed` promise MUST resolve with `CloseInfo` where `wasClean === false`

7. **No backwards transitions**: State transitions MUST be monotonic: `connecting -> open -> closing -> closed`. Implementations MUST NOT transition backwards.

8. **Promise resolution**: `closed` MUST resolve (not reject) for all close scenarios. Error information is conveyed via `CloseInfo.wasClean` and `CloseInfo.error`.

## 2. Inbound Iterator Semantics

The `inbound` property exposes received messages as an async iterable.

```typescript
interface TransportConnection {
  readonly inbound: AsyncIterable<Uint8Array>;
}
```

### 2.1 Normative Rules

1. **Message-oriented**: Each iteration MUST yield exactly one complete message as a `Uint8Array`. Partial messages MUST NOT be yielded.

2. **Completion on graceful close**: When the connection closes cleanly:
   - The iterator MUST yield any buffered messages first
   - The iterator MUST then complete (`done: true`, `value: undefined`)

3. **Error on abnormal close**: When the connection closes abnormally:
   - The iterator SHOULD yield any buffered messages first (if recoverable)
   - The iterator MUST then throw a `TransportError`

4. **Single-consumer requirement**: At most one active iterator is allowed per connection:
   - Calling `[Symbol.asyncIterator]()` while another iterator is active MUST throw `TransportError` with `kind: "transport_failure"`
   - An iterator becomes inactive when it completes, throws, or the consumer breaks out of the loop

5. **Early break behavior**: Breaking out of a `for await` loop MUST NOT close the connection:
   - The connection remains open
   - A subsequent `for await` SHOULD resume iteration
   - Buffered messages received during the break SHOULD be available

6. **Post-close message delivery**: Messages buffered before close MUST be delivered before iterator completion. Implementations MUST NOT discard buffered messages on close.

7. **Backpressure**: The iterator MAY apply backpressure by delaying `next()` resolution if the consumer is slow. Implementation-defined behavior.

### 2.2 Example

```typescript
const conn = await transport.connect(endpoint);

// Normal consumption
for await (const message of conn.inbound) {
  if (shouldStop(message)) break; // Does NOT close connection
}

// Can resume iteration
for await (const message of conn.inbound) {
  process(message);
}
// Iterator completes when connection closes
```

## 3. Send Concurrency and Ordering

### 3.1 Normative Rules

1. **Concurrent sends supported**: Implementations MUST support multiple concurrent `send()` calls without throwing or corrupting data.

2. **Internal serialization**: Implementations MUST serialize concurrent sends internally. Callers need not coordinate.

3. **Order preservation**: Messages MUST be delivered to the peer in `send()` call order, not promise resolution order:

   ```typescript
   // msg1 is delivered before msg2, regardless of which promise resolves first
   const p1 = conn.send(msg1);
   const p2 = conn.send(msg2);
   await Promise.all([p1, p2]);
   ```

4. **Non-blocking semantics**: `send()` MAY resolve before the message is fully transmitted to the network. Resolution indicates the message has been accepted for sending.

5. **Error semantics**: `send()` MUST reject with `TransportError` if:
   - `state !== "open"`
   - The message exceeds `maxMessageSize`
   - The send buffer is full and the implementation chooses to reject (see section 4)

## 4. Backpressure Semantics

### 4.1 Normative Rules

1. **Buffer pressure tolerance**: `send()` MUST NOT reject solely due to buffer pressure. Implementations MUST buffer messages when the network is slow.

2. **Send buffer limit**: Implementations SHOULD enforce a maximum send buffer size:
   - Default: 16 MiB
   - When exceeded: MAY reject `send()` with `TransportError(kind: "transport_failure")` OR close the connection

3. **Buffered amount exposure**: Implementations SHOULD expose `bufferedAmount` when the underlying transport provides it:

   ```typescript
   interface TransportConnection {
     /** Bytes queued for sending. Undefined if transport doesn't expose this. */
     readonly bufferedAmount?: number;
   }
   ```

### 4.2 Clarification: Buffer Size vs Message Size

- **`maxMessageSize`**: Limits individual message size (default: 1 MiB). A single message exceeding this is rejected immediately.
- **Send buffer limit**: Limits total bytes queued across multiple messages. Allows temporary bursts of many messages.

These limits are independent. A valid message may be rejected if it would exceed the send buffer limit.

## 5. Connect Options

All transports MUST accept a common set of connection options.

### 5.1 Interface

```typescript
interface ConnectOptions {
  /** Connection timeout in milliseconds. */
  timeoutMs?: number;
  /** Signal to abort the connection attempt. */
  signal?: AbortSignal;
}

interface Transport {
  connect(
    endpoint: TransportEndpoint,
    options?: ConnectOptions,
  ): Promise<TransportConnection>;
}
```

### 5.2 Normative Rules

1. **Timeout**: If `timeoutMs` is specified and the connection is not established within that time, `connect()` MUST reject with `TransportError(kind: "timeout")`.

2. **Abort signal**: If `signal` is aborted:
   - Before connect starts: reject immediately with `TransportError(kind: "aborted")`
   - During connect: abort the attempt and reject with `TransportError(kind: "aborted")`
   - After connected: no effect (use `close()` instead)

3. **Extensibility**: Transport-specific options (headers, TLS, subprotocols) are defined in transport-specific specifications. See `transport/websocket.md` for WebSocket extensions.

## 6. Close Semantics

### 6.1 Interface

```typescript
interface CloseOptions {
  /** WebSocket close code (1000-4999). Default: 1000. */
  code?: number;
  /** Human-readable reason. */
  reason?: string;
}

interface TransportConnection {
  close(options?: CloseOptions): Promise<void>;
}
```

### 6.2 Normative Rules

1. **Idempotency**: Multiple `close()` calls MUST NOT throw. Subsequent calls after the first MUST resolve immediately (or when the first call completes).

2. **Bounded completion**: `close()` SHOULD complete within a bounded time:
   - Recommendation: 5 seconds maximum
   - Implementations MAY force-close if the peer does not respond

3. **Pending sends rejection**: After `close()` is called, subsequent `send()` calls MUST reject immediately with `TransportError`.

4. **In-flight sends**: Sends already accepted (promise returned but not resolved) MAY complete or be cancelled. Behavior is implementation-defined.

5. **Default close code**: If `code` is not specified, implementations MUST use 1000 (normal closure).

6. **Reason truncation**: WebSocket transports SHOULD truncate `reason` to 123 bytes (RFC 6455 limit). Other transports MAY preserve longer reasons.

7. **State transition**: `close()` MUST transition `state` to `"closing"` synchronously, then to `"closed"` when complete.

### 6.3 Standard Close Codes

| Code | Meaning              | Usage                                     |
| ---- | -------------------- | ----------------------------------------- |
| 1000 | Normal closure       | Default; clean shutdown                   |
| 1001 | Going away           | Browser page unload, server shutdown      |
| 1002 | Protocol error       | Invalid frame structure                   |
| 1003 | Unsupported data     | Text frame received (binary-only rule)    |
| 1009 | Message too big      | Exceeds maxMessageSize                    |
| 1011 | Unexpected condition | Internal error                            |
| 1012 | Service restart      | Server restarting, reconnect soon         |
| 1013 | Try again later      | Server overloaded, reconnect with backoff |

## 7. Listener Accept Semantics

Server-side transports expose a listener for accepting connections.

```typescript
type ConnectionHandler = (
  connection: TransportConnection,
) => void | Promise<void>;

interface TransportListener {
  readonly address: TransportEndpoint;
  close(): Promise<void>;
}

interface Transport {
  listen?(
    endpoint: TransportEndpoint,
    handler: ConnectionHandler,
  ): Promise<TransportListener>;
}
```

### 7.1 Normative Rules

1. **Async handler support**: `ConnectionHandler` MAY return a promise. The transport MUST NOT block on handler completion before accepting the next connection.

2. **Handler error isolation**: If the handler throws (sync or async):
   - The transport MUST log the error
   - The transport MUST close the offending connection
   - The transport MUST NOT crash or stop accepting connections
   - Other connections MUST NOT be affected

3. **Concurrent accepts**: Implementations SHOULD accept connections concurrently:
   - Handler execution for connection A MUST NOT block acceptance of connection B
   - Multiple handlers MAY execute concurrently

4. **Listener close behavior**: When `listener.close()` is called:
   - The listener MUST stop accepting new connections
   - Existing connections MUST remain valid until individually closed
   - `close()` SHOULD resolve promptly (not wait for existing connections)

5. **Connection independence**: Each accepted connection is independent:
   - One connection's failure (close, error, slow consumer) MUST NOT affect other connections
   - Connections share no state at the transport layer

### 7.2 Example

```typescript
const listener = await transport.listen(endpoint, async (conn) => {
  try {
    for await (const msg of conn.inbound) {
      await conn.send(echo(msg));
    }
  } catch (err) {
    console.error("Connection error:", err);
  }
});

// Later: stop accepting, but existing connections continue
await listener.close();
```

## 8. Summary of Guarantees

| Property            | Guarantee                                      |
| ------------------- | ---------------------------------------------- |
| Message framing     | One `send()` = one `inbound` yield             |
| Send ordering       | Call order preserved                           |
| Concurrent sends    | Safe; internally serialized                    |
| Iterator consumers  | Single-consumer only                           |
| Early break         | Does not close connection                      |
| Close idempotency   | Safe to call multiple times                    |
| Handler isolation   | One connection's error doesn't affect others   |
| State observability | `state` property always reflects current state |
| Close notification  | `closed` promise resolves for all close types  |
