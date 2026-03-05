---
url: /protocols/sbrp/state-machine.md
---
# Sideband Relay Protocol State Machine

> **Authority**: Primary (Normative)\
> **Purpose**: State transitions, lifecycle semantics, and control code behavioral definitions.

Concise state models for Client, Daemon, and Relay sessions. Intended to complement the [main SBRP spec](./index.md) with implementer-facing control flow.

## Notation

* Event names are in `code` format.
* Transitions list the next state and key requirements.
* Error transitions terminate the session unless otherwise noted.
* Control codes reference §14 of the main spec.

## Control Code Quick Reference

> **Note**: This table is a non-authoritative snapshot for quick reference. For canonical code values, see [control-codes.md](./control-codes.md).

|   Code | Name               | T/N | SID | Meaning                |
| -----: | ------------------ | --- | --- | ---------------------- |
| 0x0101 | unauthorized       | T   | 0   | Invalid/expired token  |
| 0x0102 | forbidden          | T   | 0   | Access denied          |
| 0x0201 | daemon\_not\_found   | T   | S   | Unknown daemon ID      |
| 0x0202 | daemon\_offline     | T   | S   | Daemon not connected   |
| 0x0301 | session\_not\_found  | T   | S   | Unknown session ID     |
| 0x0302 | session\_expired    | T   | S   | Session terminated     |
| 0x0401 | malformed\_frame    | T   | 0   | Invalid header         |
| 0x0402 | payload\_too\_large  | T   | 0   | Exceeds 64KB           |
| 0x0403 | invalid\_frame\_type | T   | 0   | Unknown type byte      |
| 0x0404 | invalid\_session\_id | T   | 0   | SessionID invalid      |
| 0x0405 | disallowed\_sender  | T   | S   | Wrong direction        |
| 0x0601 | internal\_error     | T   | 0   | Relay internal failure |
| 0x0901 | rate\_limited       | N   | 0   | Too many requests      |
| 0x0902 | backpressure       | T   | 0   | Send buffer full       |
| 0x1001 | session\_paused     | N   | S   | Daemon disconnected    |
| 0x1002 | session\_resumed    | N   | S   | Daemon ready           |
| 0x1003 | session\_ended      | N   | S   | Client disconnected    |
| 0x1004 | session\_pending    | N   | S   | Awaiting daemon ready  |

## Client (UI)

States focus on a single daemon connection.

| State          | Event                      | Next           | Notes                                                                    |
| -------------- | -------------------------- | -------------- | ------------------------------------------------------------------------ |
| `Idle`         | `connect`                  | `Connecting`   | Open WebSocket to relay with session token.                              |
| `Connecting`   | `ws_open`                  | `Handshaking`  | Send `HandshakeInit` with client ephemeral key.                          |
| `Connecting`   | `ws_error`                 | `Closed`       | Surface transport error.                                                 |
| `Handshaking`  | `HandshakeAccept`          | `Active`       | Verify Ed25519 signature using pinned identity key; derive session keys. |
| `Handshaking`  | `Control(daemon_offline)`  | `Reconnecting` | Relay rejected before handshake; daemon was offline at connection time.  |
| `Handshaking`  | `identity_key_changed`     | `Closed`       | MUST abort; require explicit user confirmation to accept new key.        |
| `Handshaking`  | `handshake_failed`         | `Closed`       | Abort; discard ephemeral key material.                                   |
| `Active`       | `Control(session_paused)`  | `Paused`       | Keep WebSocket open; suspend encrypted sends.                            |
| `Active`       | `Control(session_expired)` | `Reconnecting` | Session ended (state lost or grace expired); trigger full handshake.     |
| `Active`       | `ws_close`                 | `Reconnecting` | Client reconnect always requires full handshake.                         |
| `Paused`       | `Control(session_pending)` | `Pending`      | Daemon reconnected; await Signal(ready) or Signal(close).                |
| `Paused`       | `Control(session_expired)` | `Reconnecting` | Trigger full handshake (new ephemeral keys).                             |
| `Pending`      | `Control(session_resumed)` | `Active`       | Resume with same session keys and sequence state.                        |
| `Pending`      | `Control(session_expired)` | `Reconnecting` | Daemon sent Signal(close); trigger full handshake.                       |
| `Reconnecting` | `ws_open`                  | `Handshaking`  | New session token required (new `sid`); generate new ephemeral keys.     |
| `Reconnecting` | `ws_error`                 | `Closed`       | Surface transport error.                                                 |
| `Active`       | `close`                    | `Closed`       | User-initiated disconnect.                                               |

## Daemon (Agent)

States focus on a single client session; daemons may have many in parallel.

| State          | Event                    | Next           | Notes                                                                                        |
| -------------- | ------------------------ | -------------- | -------------------------------------------------------------------------------------------- |
| `Idle`         | `register`               | `Registered`   | Create identity keypair; register via control plane.                                         |
| `Registered`   | `connect`                | `Connected`    | Open persistent WebSocket to relay with presence token.                                      |
| `Connected`    | `HandshakeInit`          | `Handshaking`  | Generate ephemeral X25519 and sign with identity key.                                        |
| `Handshaking`  | `HandshakeAccept_sent`   | `Active`       | Derive session keys; init sequence state.                                                    |
| `Active`       | `Control(session_ended)` | `Idle`         | Per-session cleanup only; relay signals client disconnect.                                   |
| `Active`       | `ws_close`               | `Reconnecting` | Attempt reconnect using presence token.                                                      |
| `Reconnecting` | `ws_open_within_grace`   | `Connected`    | Check state for each session; send `Signal(ready)` or `Signal(close)` per session.           |
| `Reconnecting` | `ws_open_after_grace`    | `Connected`    | Start new sessions; old session state is dropped.                                            |
| `Connected`    | `state_retained`         | `Active`       | Per-session: send `Signal(ready)`; resume with retained keys, seq counters, replay window.   |
| `Connected`    | `state_lost`             | `Connected`    | Per-session: send `Signal(close, reason=state_lost)`; await new `HandshakeInit` from client. |
| `Connected`    | `close`                  | `Closed`       | Tear down relay connection.                                                                  |

## Relay (Per-Session Pair)

A relay tracks the pairing between one client connection and one daemon connection.

| State        | Event                                  | Next         | Notes                                                                                  |
| ------------ | -------------------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| `None`       | `client_ws_open` (daemon on)           | `Paired`     | Validate session token; bind client to daemon; forward handshake.                      |
| `None`       | `client_ws_open` (daemon off)          | `Closed`     | Send `Control(daemon_offline)` (T); close client. No relay pairing created.            |
| `None`       | `daemon_ws_open`                       | `DaemonOnly` | Validate presence token; mark daemon online.                                           |
| `DaemonOnly` | `client_ws_open`                       | `Paired`     | Bind client to daemon; forward handshake messages.                                     |
| `Paired`     | `daemon_ws_close`                      | `Paused`     | Send `Control(session_paused)` to client; pause routing.                               |
| `Paired`     | `Signal(close)`                        | `Closed`     | Daemon lost state; send `Control(session_expired)` to client; close pairing.           |
| `Paused`     | `daemon_ws_open` (no `session:resume`) | `Closed`     | Non-resumable daemon; send `Control(session_expired)` to client immediately.           |
| `Paused`     | `daemon_ws_open_within_grace`          | `Pending`    | Resumable daemon reconnected; send `Control(session_pending)` to client; await Signal. |
| `Paused`     | `client_ws_close`                      | `Closed`     | Client disconnected while paused; tear down pairing (no notification).                 |
| `Paused`     | `grace_expired`                        | `Closed`     | Send `Control(session_expired)` to client; close WebSocket.                            |
| `Pending`    | `Signal(ready)`                        | `Paired`     | Send `Control(session_resumed)` to client; resume routing.                             |
| `Pending`    | `Signal(close)`                        | `Closed`     | Daemon lost state; send `Control(session_expired)` to client; close pairing.           |
| `Pending`    | `client_ws_close`                      | `Closed`     | Client disconnected; send `Control(session_ended)` to daemon.                          |
| `Pending`    | `grace_expired`                        | `Closed`     | Timeout waiting for daemon signal; send `Control(session_expired)`.                    |
| `Paired`     | `client_ws_close`                      | `Closed`     | Send `Control(session_ended)` to daemon; tear down pairing.                            |

## Required Invariants

* No encrypted traffic before `Active` is reached.
* Client MUST obtain a new session token (new `sid`) on reconnect; no client-side session resumption.
* Handshake SHOULD complete within 30 seconds; timeout triggers `handshake_failed`.
* Ping/Pong frames are connection-scoped (SessionID = 0) and never forwarded.
* Relay MUST respond to Ping with Pong, copying payload.

### Resumable Daemons (`"session:resume"` in `scp`)

* A resumed session MUST reuse the same session keys and sequence state.
* After reconnect, daemon MUST send `Signal(ready)` for sessions with retained state, `Signal(close, reason=state_lost)` for sessions with lost state.
* Relay MUST send `Control(session_pending)` to client when daemon reconnects.
* Relay MUST NOT send `Control(session_resumed)` until daemon sends `Signal(ready)`.
* If sequence state is lost (even partially), daemon MUST send `Signal(close, reason=state_lost)` for that session before processing frames.
* If the daemon process restarts or loses volatile memory, it MUST send `Signal(close, reason=state_lost)` for all sessions.

### State Integrity Verification

Before sending `Signal(ready)` for a session, the daemon MUST verify that all required per-session state is present, well-formed, and internally consistent. If verification fails, daemon MUST send `Signal(close, reason=state_lost)` for that session.

**Required components** (per [wire-crypto.md](./wire-crypto.md)):

* Session ID
* Directional traffic keys (`clientToDaemon`, `daemonToClient`)
* Send sequence number
* Receive replay state (`maxSeen` and bitmap)

**Verification requirements:**

1. All components MUST be present
2. Keys MUST be correct length (32 bytes each)
3. Sequence numbers MUST be valid (non-negative, not exhausted)
4. Replay window MUST be consistent with `maxSeen`

If any check fails → `Signal(close, reason=state_lost)` for that session.
If all checks pass → `Signal(ready)` for that session.

::: tip Implementation Note
For in-memory state (the common case), verification requires checking that:

1. The session object exists with all fields populated
2. Key lengths are correct (32 bytes each)
3. Sequence numbers are valid and not exhausted
4. Replay window is consistent with `maxSeen`

Merely confirming field presence is necessary but not sufficient. Daemons that do not persist session state across process restarts will fail these checks on restart and MUST close all sessions.

For daemons that persist state to durable storage, implementations SHOULD add an integrity check (e.g., HMAC or authenticated encryption) to detect corruption or tampering during storage.
:::

### Non-Resumable Daemons (`"session:resume"` absent from `scp`)

* Relay MUST send `Control(session_expired)` to all paired clients immediately upon daemon reconnect.
* Daemon need not track session IDs or send Signal frames.

### Relay Routing Rules (Frame Authority)

| Frame Type      | Client Can Send | Daemon Can Send | Relay Action              |
| --------------- | --------------- | --------------- | ------------------------- |
| HandshakeInit   | ✓               | ✗               | Forward to daemon         |
| HandshakeAccept | ✗               | ✓               | Forward to client         |
| Data            | ✓               | ✓               | Forward to peer           |
| Signal          | ✗               | ✓               | Process (ready/close)     |
| Ping            | ✓               | ✓               | Respond with Pong locally |
| Pong            | ✓               | ✓               | Process locally           |
| Control         | ✗               | ✗               | Relay generates only      |

Relay MUST validate frames in order per §13.3 (header parse → payload size → frame type → SessionID validity → direction) and return the first matching error.
