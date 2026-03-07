# Testing

Sideband is straightforward to test because transport is injectable. For most integration tests,
use `LoopbackTransport` from `@sideband/transport` to run client and server in one process.

---

## Minimal Loopback Pair

```typescript
import { createPeer } from "@sideband/peer";
import { listen } from "@sideband/peer/server";
import { LoopbackTransport } from "@sideband/transport";

const transport = new LoopbackTransport();
const endpoint = "loopback://test";

const server = await listen({
  endpoint,
  transport,
  onConnection(peer) {
    peer.rpc.handle<{ a: number; b: number }, number>(
      "add",
      ({ a, b }) => a + b,
    );
  },
});

const client = createPeer({
  endpoint,
  transport,
  retryPolicy: { mode: "never" },
});
await client.connect();

const result = await client.rpc.call<number>("add", { a: 1, b: 2 });
// result === 3

await client.disconnect();
await server.close();
```

---

## Testing RPC + Events Together

```typescript
import { test, expect } from "bun:test";
import { createPeer } from "@sideband/peer";
import { listen } from "@sideband/peer/server";
import { LoopbackTransport } from "@sideband/transport";

test("rpc triggers event", async () => {
  const transport = new LoopbackTransport();
  const endpoint = "loopback://rpc-events";
  const received: unknown[] = [];

  const server = await listen({
    endpoint,
    transport,
    onConnection(peer) {
      peer.rpc.handle("task.run", ({ taskId }: { taskId: string }) => {
        peer.events.emit("task.completed", { taskId });
        return { ok: true };
      });
    },
  });

  const client = createPeer({
    endpoint,
    transport,
    retryPolicy: { mode: "never" },
  });
  client.events.on("task.completed", (data) => received.push(data));
  await client.connect();

  await client.rpc.call("task.run", { taskId: "abc" });
  expect(received).toHaveLength(1);

  await client.disconnect();
  await server.close();
});
```

---

## Simulating Disconnect/Reconnect

`LoopbackTransport` does not expose `drop()`/`restore()` helpers. Simulate outages by closing
the server and starting it again on the same endpoint.

```typescript
import { createPeer } from "@sideband/peer";
import { listen } from "@sideband/peer/server";
import { LoopbackTransport } from "@sideband/transport";

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start >= timeoutMs) throw new Error("waitFor timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const transport = new LoopbackTransport();
const endpoint = "loopback://reconnect";

let server = await listen({ endpoint, transport, onConnection() {} });
const client = createPeer({
  endpoint,
  transport,
  connectionPolicy: { onDisconnect: "pause" },
  retryPolicy: {
    mode: "on-error",
    initialDelayMs: 10,
    maxDelayMs: 50,
    maxAttempts: 10,
    jitter: 0,
  },
});

await client.connect();
await server.close(); // force disconnect
await waitFor(() => client.state === "reconnecting");

server = await listen({ endpoint, transport, onConnection() {} }); // allow reconnect
await waitFor(() => client.state === "active");

await client.disconnect();
await server.close();
```

---

## SBRP Coverage

For encrypted session coverage, reuse the same loopback pattern but pass
`relayClientNegotiator(...)` and `relayDaemonNegotiator(...)`. Current reference tests live in:

- `packages/peer/src/negotiator/*.test.ts`
- `packages/peer/src/peer.session-signals.test.ts`

---

## See Also

- [Concepts — Sessions and Negotiators](concepts.md#sessions-and-negotiators)
- `packages/peer/src/peer.test.ts` — lifecycle and RPC integration tests
- `packages/transport/src/loopback.ts` — transport behavior
