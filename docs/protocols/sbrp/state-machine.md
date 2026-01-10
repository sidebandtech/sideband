# Sideband Relay Protocol State Machine

Concise state models for Client, Daemon, and Relay sessions. Intended to complement the [main SBRP spec](./index.md) with implementer-facing control flow.

## Notation

- Event names are in `code` format.
- Transitions list the next state and key requirements.
- Error transitions terminate the session unless otherwise noted.
- Control codes reference §14 of the main spec.

## Client (UI)

States focus on a single daemon connection.

| State          | Event                      | Next           | Notes                                                                    |
| -------------- | -------------------------- | -------------- | ------------------------------------------------------------------------ |
| `Idle`         | `connect`                  | `Connecting`   | Open WebSocket to relay with session token.                              |
| `Connecting`   | `ws_open`                  | `Handshaking`  | Send `HandshakeInit` with client ephemeral key.                          |
| `Connecting`   | `ws_error`                 | `Closed`       | Surface transport error.                                                 |
| `Handshaking`  | `HandshakeAccept`          | `Active`       | Verify Ed25519 signature using pinned identity key; derive session keys. |
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

| State        | Event                         | Next         | Notes                                                                                  |
| ------------ | ----------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| `None`       | `client_ws_open`              | `ClientOnly` | Validate session token; await pairing.                                                 |
| `None`       | `daemon_ws_open`              | `DaemonOnly` | Validate presence token; mark daemon online.                                           |
| `ClientOnly` | `daemon_ws_open`              | `Paired`     | Bind client to daemon; forward handshake messages.                                     |
| `DaemonOnly` | `client_ws_open`              | `Paired`     | Bind client to daemon; forward handshake messages.                                     |
| `Paired`     | `daemon_ws_close`             | `Paused`     | Send `Control(session_paused)` to client; pause routing.                               |
| `Paired`     | `Signal(close)`               | `Closed`     | Daemon lost state; send `Control(session_expired)` to client; close pairing.           |
| `Paused`     | `daemon_ws_open(res=false)`   | `Closed`     | Non-resumable daemon; send `Control(session_expired)` to client immediately.           |
| `Paused`     | `daemon_ws_open_within_grace` | `Pending`    | Resumable daemon reconnected; send `Control(session_pending)` to client; await Signal. |
| `Paused`     | `client_ws_close`             | `Closed`     | Client disconnected while paused; tear down pairing (no notification).                 |
| `Paused`     | `grace_expired`               | `Closed`     | Send `Control(session_expired)` to client; close WebSocket.                            |
| `Pending`    | `Signal(ready)`               | `Paired`     | Send `Control(session_resumed)` to client; resume routing.                             |
| `Pending`    | `Signal(close)`               | `Closed`     | Daemon lost state; send `Control(session_expired)` to client; close pairing.           |
| `Pending`    | `client_ws_close`             | `Closed`     | Client disconnected; send `Control(session_ended)` to daemon.                          |
| `Pending`    | `grace_expired`               | `Closed`     | Timeout waiting for daemon signal; send `Control(session_expired)`.                    |
| `Paired`     | `client_ws_close`             | `Closed`     | Send `Control(session_ended)` to daemon; tear down pairing.                            |

## Required Invariants

- No encrypted traffic before `Active` is reached.
- Client MUST obtain a new session token (new `sid`) on reconnect; no client-side session resumption.
- Handshake SHOULD complete within 30 seconds; timeout triggers `handshake_failed`.
- Ping/Pong frames are connection-scoped (SessionID = 0) and never forwarded.
- Relay MUST respond to Ping with Pong, copying payload.

### Resumable Daemons (default, `res` claim absent or `true`)

- A resumed session MUST reuse the same session keys and sequence state.
- After reconnect, daemon MUST send `Signal(ready)` for sessions with retained state, `Signal(close)` for sessions with lost state.
- Relay MUST send `Control(session_pending)` to client when daemon reconnects.
- Relay MUST NOT send `Control(session_resumed)` until daemon sends `Signal(ready)`.
- If sequence state is lost (even partially), daemon MUST send `Signal(close)` for that session before processing frames.
- If the daemon process restarts or loses volatile memory, it MUST send `Signal(close)` for all sessions.

### Non-Resumable Daemons (`res: false`)

- Relay MUST send `Control(session_expired)` to all paired clients immediately upon daemon reconnect.
- Daemon need not track session IDs or send Signal frames.

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
