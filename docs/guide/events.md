# Events

Sideband events are fire-and-forget notifications. Unlike RPC, events have no response — they
are dispatched to all matching subscribers. This makes them appropriate for state changes,
progress updates, and broadcast notifications.

---

## Emitting Events

```typescript
peer.events.emit("task.completed", { taskId: "abc123", duration: 342 });
```

`emit()` is synchronous. It throws only for invalid event names; send failures are handled
asynchronously through `onUnhandledError`. If the peer is not `active`, the event is buffered
(up to `eventPolicy.maxBufferedEvents`, default 128; evict-oldest on overflow). On transition to
`closed`, buffered events are discarded silently.

---

## Subscribing by Name

```typescript
const unsubscribe = peer.events.on("task.completed", (data) => {
  console.log("Task done:", data.taskId);
});

// Later:
unsubscribe();
```

`on()` matches exact event names only. For wildcard matching, use `onPattern()`.

---

## Pattern Subscriptions

`onPattern()` uses NATS dot-separated syntax with two wildcards:

| Wildcard | Matches                              |
| -------- | ------------------------------------ |
| `*`      | Exactly one segment                  |
| `>`      | One or more segments (must be final) |

```typescript
// Matches "task.created", "task.updated", "task.completed" — not "task.step.done"
peer.events.onPattern("task.*", (name, data) => {
  console.log(`Event: ${name}`, data);
});

// Matches everything under "sensor." — any depth
peer.events.onPattern("sensor.>", (name, data) => {
  console.log(`Sensor event: ${name}`);
});
```

`onPattern()` returns an idempotent `unsubscribe()` function.

---

## Wildcard Reference

```text
event_name = token ("." token)*
pattern    = segment ("." segment)*
segment    = token | "*" | ">"
token      = 1+ alphanumeric / "-" / "_"
```

Valid examples:

```
task.created               ← exact match
task.*                     ← matches task.created, task.updated (one segment)
task.>                     ← matches task.created, task.step.done (one or more)
sensor.temperature.*       ← matches sensor.temperature.reading
sensor.>                   ← matches sensor.temperature, sensor.a.b (not "sensor" alone)
```

Invalid as event names:

```
task.**                    ← rejected: use > not **
*.created                  ← rejected: wildcards are not valid in emitted event names
task..event                ← rejected: empty segment
```

Note: `*.created` is valid as a _subscription pattern_ (matches `task.created`, `job.created`,
etc.) — it is only rejected when used as an event name in `emit()`.

`onPattern()` throws `PeerError{ code: "invalid_pattern" }` synchronously for invalid patterns.

---

## Dispatch Semantics

- All matching handlers are called, in registration order.
- A handler throwing does not abort dispatch to remaining handlers — the error is forwarded to
  `peerOptions.onUnhandledError`.
- There is no acknowledgement or reply. If you need confirmation, use RPC.

---

## Subscriptions Survive Reconnects

Subscriptions are in-process registrations — they are not re-sent to the remote peer on reconnect.
This means:

- Subscriptions outlive individual sessions.
- No re-registration boilerplate on reconnect.
- The pattern matching happens locally on every inbound message.

---

## Buffer Behavior During Reconnection

Outbound events emitted while `paused` or `reconnecting` are buffered in a capped queue (default
128 events, `eventPolicy.maxBufferedEvents`). When the buffer is full, the oldest event is
silently discarded. On transition to `closed`, all buffered events are discarded.

---

## See Also

- [Concepts — State Machine](concepts.md#state-machine)
- ADR-013: NATS-style event pattern syntax
- `docs/protocols/rpc/envelope.md` — Notification wire format (`t: "N"`)
- `docs/sdk/peer.md` §6.6 — Events interface RFC
