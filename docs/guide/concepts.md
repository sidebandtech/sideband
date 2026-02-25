# Core Concepts

This page explains the mental model behind Sideband. You don't need to understand all of it
to get started — the [quick start](index.md) gets you running in five lines — but understanding
the concepts helps when you hit edge cases.

---

## Peers

A **Peer** is a long-lived connection endpoint. You create one, connect it, and use it until you
disconnect. One peer = one logical connection.

```typescript
const peer = createPeer({ endpoint: "ws://localhost:8080" });
await peer.connect();
// ... use peer
await peer.disconnect();
```

On the server side, `listen()` accepts incoming connections. Each accepted connection is an
`AcceptedPeer` — the same abstraction, but with no `connect()` (the server doesn't initiate).

---

## Sessions and Negotiators

A **session** is what happens when the transport connects. Before any application messages flow,
both sides run a **negotiator** — a protocol handshake that establishes identity, capabilities,
and optionally an encrypted channel.

The default negotiator (`SBP`) just exchanges peer IDs and capabilities. The SBRP negotiator
adds E2EE on top: same API, different negotiator option.

```typescript
// Plain (no encryption)
createPeer({ endpoint: "ws://..." });

// E2EE via relay (SBRP)
createPeer({
  endpoint: relayUrl, // from POST /api/sessions
  negotiator: sbrpClientNegotiator({
    daemonId,
    sessionToken,
    identityKeyStore,
  }),
});
```

Everything above the negotiator — RPC, events, reconnection — is identical regardless of which
session layer is active.

---

## Subjects and Channels

Every message frame carries a **subject** — a routing label that determines how the runtime
dispatches it:

| Subject  | Semantics                                                 |
| -------- | --------------------------------------------------------- |
| `rpc`    | Request/response — exactly one handler, exactly one reply |
| `event`  | Fire-and-forget — all matching handlers called            |
| `stream` | Reserved (v2)                                             |
| `app/*`  | Custom application protocols (user-defined)               |

`rpc` and `event` are the two active built-in channels. `stream` is reserved for future use.
The `app/*` namespace is open for application-defined protocols.

Method and event names live inside the frame payload (the RPC envelope), not in the subject.
The subject identifies the message class; the envelope identifies the operation.

---

## State Machine

A peer moves through states in a defined order. Understanding states matters when you handle
errors or want to react to connection changes.

```
idle → connecting → negotiating → active
         ↑                          ↓
         └──── reconnecting ────────┘
active ↔ paused  (SBRP only: relay lost upstream)
any → closed  (terminal)
```

Reconnection always goes through the full `connecting → negotiating → active` cycle — session
state is re-established, not resumed from mid-handshake.

| State          | Meaning                                                 |
| -------------- | ------------------------------------------------------- |
| `idle`         | Not connected. Initial state.                           |
| `connecting`   | Transport connect in progress.                          |
| `negotiating`  | Transport open; handshake in progress.                  |
| `active`       | Ready to send and receive.                              |
| `paused`       | SBRP session pause — relay buffering, not disconnected. |
| `reconnecting` | Waiting before retry attempt.                           |
| `closed`       | Terminal. No further transitions.                       |

`peer.ready` is `true` only in `active`. `peer.connected` is `true` in both `active` and `paused`.

---

## RPC

RPC follows a request/response pattern. Each call is correlated by a `cid` (correlation ID)
assigned at send time. With `onDisconnect: "pause"`, the call intent is buffered across
reconnections and sent with a fresh `cid` once the session is restored. See the [RPC guide](rpc.md).

---

## Events

Events are fire-and-forget notifications. Subscribers use NATS-style dot-separated names with
`*` (one segment) and `>` (one or more segments) wildcards. See the [Events guide](events.md).

---

## E2EE and Identity

In SBRP mode, the daemon has a persistent Ed25519 identity keypair. The client pins the daemon's
public key fingerprint on first connection (TOFU — Trust On First Use). Subsequent connections
verify against the pinned key; a mismatch is fatal (not retryable). The relay never sees
plaintext — all frame content is ChaCha20-Poly1305 encrypted end-to-end.

See the [E2EE guide](e2ee.md) for setup.
