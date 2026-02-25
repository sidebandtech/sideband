---
url: /guide/rpc.md
---
# RPC

Sideband RPC is request/response — the caller sends a request and awaits a typed result.
Correlation is protocol-level (via `cid`); you never manage correlation IDs manually.

***

## Basic Call

```typescript
const result = await peer.rpc.call<{ content: string }>("file.read", {
  path: "./README.md",
});
console.log(result.content);
```

`call()` throws `PeerError` if:

* The peer is not `active` and `onDisconnect` is `"fail"` (default)
* The call times out
* The server handler returns an error
* The call is cancelled via `AbortSignal`

***

## Typed RPC Client

Use `TypedRpcClient<T>` when you control both sides. Define a shared interface, then get a
fully-typed proxy — no type assertions, no string method names in call sites.

```typescript
interface FilesApi {
  "file.read": (params: { path: string }) => { content: string };
  "file.write": (params: { path: string; content: string }) => void;
}

// Client side
const files = peer.rpc.client<FilesApi>();
const { content } = await files["file.read"]({ path: "./README.md" });
```

***

## Registering Handlers

On the server side (or for bidirectional RPC), register handlers with `rpc.handle()`. Returns an
`Unsubscribe` function to deregister.

```typescript
const unsubscribe = peer.rpc.handle<{ path: string }, { content: string }>(
  "file.read",
  async ({ path }) => ({ content: await Bun.file(path).text() }),
);
```

Handler registration enforces uniqueness per method — registering the same method twice throws
`PeerError{ code: "rpc_method_already_registered" }` synchronously.

***

## Error Handling

Server-side handler errors are propagated to the caller as `PeerError`. The handler never needs
to manually send an error frame — throw or return a rejected promise.

```typescript
peer.rpc.handle("file.read", async ({ path }) => {
  if (!path.startsWith("/safe/")) {
    throw new Error("Access denied");
  }
  return { content: await Bun.file(path).text() };
});
```

Caller side:

```typescript
try {
  const result = await peer.rpc.call("file.read", { path: "/etc/passwd" });
} catch (err) {
  if (err instanceof PeerError) {
    console.error(err.code, err.message);
  }
}
```

***

## Timeouts

Default timeout is 10 seconds (`rpcPolicy.defaultTimeoutMs`). Override per call:

```typescript
const result = await peer.rpc.call("slow.operation", params, {
  timeoutMs: 30_000,
});
```

Timeout throws `PeerError{ code: "rpc_timeout" }`.

***

## Cancellation via AbortSignal

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

try {
  const result = await peer.rpc.call("long.op", params, {
    signal: controller.signal,
  });
} catch (err) {
  if (err instanceof PeerError && err.code === "rpc_cancelled") {
    console.log("User cancelled");
  }
}
```

Aborting cancels the local promise. If the request is sitting in the disconnect buffer (queued
during `reconnecting` or `paused`), it is evicted and will not be sent. If already in-flight, the
request is abandoned; the server may still execute and reply (the reply is silently dropped).

***

## tryCall — Reconnection-Aware

`tryCall` wraps `call` and also exposes whether the peer was not `active` when the call was
made (`reconnected: true`). This covers both first-connect buffering and post-reconnect flushing —
useful for telemetry or deciding whether to re-validate server state.

```typescript
const outcome = await peer.rpc.tryCall("task.status", { taskId });
if (outcome.ok) {
  if (outcome.reconnected) {
    console.log(
      "Buffered during readiness gap — result may reflect later session state",
    );
  }
  console.log(outcome.value);
} else {
  console.error(outcome.error.code);
}
```

***

## Buffering During Reconnection

With `connectionPolicy.onDisconnect: "pause"`, RPC calls made while the peer is reconnecting are
buffered and replayed once the session is restored. Timeouts are wall-clock — a call with a 10 s
timeout that sits in the buffer for 15 s will reject with `rpc_timeout` without being sent. Buffer
limit is controlled by `rpcPolicy.disconnectBufferLimitBytes` (default 64 KiB). Overflow throws
`PeerError{ code: "buffer_overflow" }`.

With `onDisconnect: "fail"` (default), calls made while not `active` throw immediately.

***

## See Also

* [Concepts — Subjects and Channels](concepts.md#subjects-and-channels)
* `docs/protocols/rpc/envelope.md` — Wire format for RPC envelopes
* `docs/sdk/peer.md` §6.5 — RPC interface RFC
