# Control Codes

> **Authority**: Primary (Reference)  
> **Purpose**: Catalog of control code values, names, and flags. Behavioral semantics defined in [state-machine.md](./state-machine.md).  
> **Stability Note**: This document exists to stabilize numeric code assignments. Once the control code set is frozen, this catalog MAY be inlined into state-machine.md as an appendix.

## Code Ranges

Control frames (`0x20`) are relay-originated only. Ranges enable category discrimination:

| Range           | Category       | Description                    |
| --------------- | -------------- | ------------------------------ |
| `0x01xx`        | Authentication | Token and authorization errors |
| `0x02xx`        | Routing        | Daemon discovery and presence  |
| `0x03xx`        | Session        | Session lifecycle errors       |
| `0x04xx`        | Wire format    | Protocol violations            |
| `0x05xx`        | Reserved       | Future use                     |
| `0x06xx`        | Internal       | Relay internal errors          |
| `0x07xx–0x08xx` | Reserved       | Future use                     |
| `0x09xx`        | Throttling     | Traffic control (varies: N/T)  |
| `0x0Axx–0x0Fxx` | Reserved       | Future use                     |
| `0x10xx`        | Session state  | Non-terminal state transitions |
| `0x11xx–0x1Fxx` | Reserved       | Future state notifications     |
| `0xE0xx`        | SDK-only       | Never transmitted on wire      |

## Wire Codes (Relay → Endpoint)

**Legend**: T=terminal (closes WebSocket), N=non-terminal. SID: 0=connection-level, S=session-specific.

### Authentication (0x01xx)

| Code   | Name           | T/N | SID | Meaning                    | When Emitted             |
| ------ | -------------- | --- | --- | -------------------------- | ------------------------ |
| 0x0101 | `unauthorized` | T   | 0   | Invalid or expired token   | Token validation failure |
| 0x0102 | `forbidden`    | T   | 0   | Valid token, access denied | User doesn't own daemon  |

### Routing (0x02xx)

| Code   | Name               | T/N | SID | Meaning              | When Emitted                    |
| ------ | ------------------ | --- | --- | -------------------- | ------------------------------- |
| 0x0201 | `daemon_not_found` | T   | S   | Unknown daemon ID    | Daemon doesn't exist            |
| 0x0202 | `daemon_offline`   | T   | S   | Daemon not connected | Client connects, daemon offline |

### Session (0x03xx)

| Code   | Name                | T/N | SID | Meaning            | When Emitted                            |
| ------ | ------------------- | --- | --- | ------------------ | --------------------------------------- |
| 0x0301 | `session_not_found` | T   | S   | Unknown session ID | Frame references invalid session        |
| 0x0302 | `session_expired`   | T   | S   | Session terminated | Grace expired, Signal(close), or policy |

### Wire Format (0x04xx)

| Code   | Name                 | T/N | SID | Meaning                     | When Emitted                               |
| ------ | -------------------- | --- | --- | --------------------------- | ------------------------------------------ |
| 0x0401 | `malformed_frame`    | T   | 0   | Invalid header structure    | Header parse failure, truncated frame      |
| 0x0402 | `payload_too_large`  | T   | 0   | Exceeds 64KB limit          | Payload length > MAX_PAYLOAD_SIZE          |
| 0x0403 | `invalid_frame_type` | T   | 0   | Unknown type byte           | Type byte not in defined set               |
| 0x0404 | `invalid_session_id` | T   | 0   | SessionID invalid for frame | Session-bound with 0, or Ping/Pong with >0 |
| 0x0405 | `disallowed_sender`  | T   | S   | Wrong direction for frame   | Client sends Signal, peer sends Control    |

### Internal (0x06xx)

| Code   | Name             | T/N | SID | Meaning                | When Emitted                                                                |
| ------ | ---------------- | --- | --- | ---------------------- | --------------------------------------------------------------------------- |
| 0x0601 | `internal_error` | T   | 0   | Relay internal failure | Connection-fatal relay failure; reconnect may succeed on a healthy instance |

### Throttling (0x09xx)

| Code   | Name           | T/N | SID | Meaning           | When Emitted          |
| ------ | -------------- | --- | --- | ----------------- | --------------------- |
| 0x0901 | `rate_limited` | N   | 0   | Too many requests | Message rate exceeded |
| 0x0902 | `backpressure` | T   | 0   | Send buffer full  | Receiver too slow     |

Rate limiting (`rate_limited`) is non-terminal and connection-level — the connection stays open and the sender should back off. Backpressure (`backpressure`) is terminal — the slow consumer is closed because silently dropping forwarded frames would corrupt the E2EE sequence stream.

### Session State (0x10xx)

| Code   | Name              | T/N | SID | Direction      | Meaning                                   |
| ------ | ----------------- | --- | --- | -------------- | ----------------------------------------- |
| 0x1001 | `session_paused`  | N   | S   | Relay → Client | Daemon disconnected; traffic suspended    |
| 0x1002 | `session_resumed` | N   | S   | Relay → Client | Daemon reconnected and ready              |
| 0x1003 | `session_ended`   | N   | S   | Relay → Daemon | Client disconnected; cleanup session      |
| 0x1004 | `session_pending` | N   | S   | Relay → Client | Daemon reconnected; awaiting ready signal |

## Endpoint Codes (SDK Only)

These codes exist for SDK error handling and logging. They are never transmitted in Control frames.

| Code   | Name                   | Detected by | Meaning                               |
| ------ | ---------------------- | ----------- | ------------------------------------- |
| 0xE001 | `identity_key_changed` | Client      | TOFU key mismatch; possible MITM      |
| 0xE002 | `handshake_failed`     | Client      | Signature verification failed         |
| 0xE003 | `handshake_timeout`    | Either      | 30s handshake deadline exceeded       |
| 0xE004 | `decrypt_failed`       | Either      | ChaCha20-Poly1305 decrypt/auth failed |
| 0xE005 | `sequence_error`       | Either      | Sequence outside replay window        |

**Reserved ranges for endpoint codes:**

- `0xE0xx`: SBRP v1 SDK codes
- `0xE1xx–0xEFxx`: Future SDK versions
- `0xF0xx–0xFFxx`: Vendor/application-specific

## Interpreting T/N and SID

**Terminality (T/N)**:

- **T (Terminal)**: Relay sends Control frame then closes WebSocket. Client should not retry on same connection.
- **N (Non-terminal)**: Connection remains open. Client may wait, retry, or take appropriate action.

**SessionID scope (SID)**:

- **0**: Connection-level error; use SessionID=0 in frame header.
- **S**: Session-specific; use the relevant non-zero SessionID in frame header.
