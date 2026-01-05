# Sideband Relay Protocol State Machine

Concise state models for Client, Daemon, and Relay sessions. Intended to complement `secure-relay-protocol.md` with implementer-facing control flow.

## Notation

- Event names are in `code` format.
- Transitions list the next state and key requirements.
- Error transitions terminate the session unless otherwise noted.

## Client (UI)

States focus on a single daemon connection.

| State          | Event                           | Next           | Notes                                                                    |
| -------------- | ------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `Idle`         | `connect`                       | `Connecting`   | Open WebSocket to relay with user session.                               |
| `Connecting`   | `ws_open`                       | `Handshaking`  | Send `handshake.init` with client ephemeral key.                         |
| `Connecting`   | `ws_error`                      | `Closed`       | Surface transport error.                                                 |
| `Handshaking`  | `handshake.accept`              | `Active`       | Verify Ed25519 signature using pinned identity key; derive session keys. |
| `Handshaking`  | `identity_key_changed`          | `Closed`       | MUST abort; require explicit user confirmation to accept new key.        |
| `Handshaking`  | `handshake_failed`              | `Closed`       | Abort; discard ephemeral key material.                                   |
| `Active`       | `daemon_disconnect`             | `Paused`       | Keep WebSocket open; suspend encrypted sends.                            |
| `Active`       | `ws_close`                      | `Reconnecting` | Client reconnect always requires full handshake.                         |
| `Paused`       | `daemon_reconnect_within_grace` | `Active`       | Resume with same session keys and sequence state.                        |
| `Paused`       | `relay_session_lost`            | `Reconnecting` | Trigger full handshake (new ephemeral keys).                             |
| `Reconnecting` | `ws_open`                       | `Handshaking`  | Full handshake required.                                                 |
| `Reconnecting` | `ws_error`                      | `Closed`       | Surface transport error.                                                 |
| `Active`       | `close`                         | `Closed`       | User-initiated disconnect.                                               |

## Daemon (Agent)

States focus on a single client session; daemons may have many in parallel.

| State          | Event                   | Next           | Notes                                                                                                 |
| -------------- | ----------------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `Idle`         | `register`              | `Registered`   | Create identity keypair; register public key with relay.                                              |
| `Registered`   | `connect`               | `Connected`    | Open persistent WebSocket to relay with API key.                                                      |
| `Connected`    | `handshake.init`        | `Handshaking`  | Generate ephemeral X25519 and sign with identity key.                                                 |
| `Handshaking`  | `handshake.accept_sent` | `Active`       | Derive session keys; init sequence state.                                                             |
| `Active`       | `client_disconnect`     | `Idle`         | Per-session cleanup only.                                                                             |
| `Active`       | `ws_close`              | `Reconnecting` | Attempt reconnect using same API key.                                                                 |
| `Reconnecting` | `ws_open_within_grace`  | `Active`       | Resume per-session keys and sequence state only if still in memory; otherwise require full handshake. |
| `Reconnecting` | `ws_open_after_grace`   | `Connected`    | Start new sessions; old session state is dropped.                                                     |
| `Active`       | `sequence_state_lost`   | `Handshaking`  | MUST force full handshake before sending encrypted data.                                              |
| `Connected`    | `close`                 | `Closed`       | Tear down relay connection.                                                                           |

## Relay (Per-Session Pair)

A relay tracks the pairing between one client connection and one daemon connection.

| State        | Event                           | Next         | Notes                                                                      |
| ------------ | ------------------------------- | ------------ | -------------------------------------------------------------------------- |
| `None`       | `client_ws_open`                | `ClientOnly` | Authenticate session; provide daemon list and identity key.                |
| `None`       | `daemon_ws_open`                | `DaemonOnly` | Authenticate API key; mark daemon online.                                  |
| `ClientOnly` | `daemon_ws_open`                | `Paired`     | Bind client to daemon; forward handshake messages.                         |
| `DaemonOnly` | `client_ws_open`                | `Paired`     | Bind client to daemon; forward handshake messages.                         |
| `Paired`     | `daemon_disconnect`             | `Paused`     | Keep client socket open; pause encrypted traffic.                          |
| `Paused`     | `daemon_reconnect_within_grace` | `Paired`     | Resume routing with existing session state.                                |
| `Paused`     | `grace_expired`                 | `Closed`     | Tear down pairing; client must re-handshake.                               |
| `Paired`     | `client_disconnect`             | `Closed`     | Tear down pairing; daemon session state may be retained for other clients. |

## Required Invariants

- No encrypted traffic before `Active` is reached.
- A resumed session MUST reuse the same session keys and sequence state.
- If sequence state is lost, a full handshake is REQUIRED before resuming encrypted traffic.
- If the daemon process restarts or loses volatile memory, it MUST NOT resume a session and MUST require a full handshake.
