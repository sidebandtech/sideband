---
url: /guide/e2ee.md
---
# E2EE Relay (SBRP)

By default, Sideband uses the plain SBP handshake — peers exchange IDs and start talking.
For production use behind NAT, you want E2EE relay mode: the Sideband relay forwards your
messages, but cannot read them.

***

## How it Works

```
Browser (client) ──SBRP──▶ Relay ──SBRP──▶ Daemon
        ◀──────────────────────────────────────────
```

The relay routes encrypted frames by `daemonId`. Frame content is ChaCha20-Poly1305 encrypted
end-to-end — the relay never holds session keys. Identity is verified via Ed25519 signatures;
a MITM attack changes the key and fails TOFU verification.

See `docs/protocols/sbrp/` for the full protocol specification.

***

## Daemon Setup

The daemon has a persistent identity keypair. Generate it once on first run and persist it.

```typescript
import { listen } from "@sideband/peer/server";
import { sbrpDaemonNegotiator } from "@sideband/peer/sbrp";
import { generateIdentityKeyPair } from "@sideband/secure-relay";
import * as fs from "node:fs/promises";

const identityPath = ".sideband/identity.json";

async function loadOrCreateIdentity() {
  try {
    return JSON.parse(await fs.readFile(identityPath, "utf8"));
  } catch {
    const created = generateIdentityKeyPair();
    await fs.mkdir(".sideband", { recursive: true });
    await fs.writeFile(identityPath, JSON.stringify(created));
    return created;
  }
}

const identity = await loadOrCreateIdentity();

const server = await listen({
  endpoint: "wss://eu-1.relay.sideband.cloud",
  negotiator: sbrpDaemonNegotiator({
    daemonId: "my-daemon-id",
    identityKeyPair: identity,
    presenceToken, // long-lived JWT from daemon registration
  }),
  onConnection(peer) {
    peer.rpc.handle("ping", () => "pong");
  },
});
```

***

## Client Setup

The client connects to the relay using the daemon's ID. On first connection, the client sees
the daemon's identity fingerprint and must decide whether to trust it.

```typescript
import { createPeer } from "@sideband/peer";
import { sbrpClientNegotiator } from "@sideband/peer/sbrp";

// relayUrl and sessionToken from POST /api/sessions
const { relayUrl, token: sessionToken } = await api.createSession({
  daemonId: "my-daemon-id",
});

const peer = createPeer({
  endpoint: relayUrl,
  negotiator: sbrpClientNegotiator({
    daemonId: "my-daemon-id",
    sessionToken,
    identityKeyStore, // see Key Management below
    trustPolicy: "prompt", // default: ask on first connection
    onFirstConnection: async ({ fingerprint }) => {
      return confirm(`Trust daemon with fingerprint ${fingerprint}?`);
    },
    onIdentityMismatch: async ({
      expectedFingerprint,
      receivedFingerprint,
    }) => {
      return confirm(
        `Identity changed. Expected ${expectedFingerprint}, received ${receivedFingerprint}. Trust new key?`,
      );
    },
  }),
});

await peer.connect();
```

***

## TOFU Trust Model

TOFU — Trust On First Use — means the first connection establishes the trusted identity. All
subsequent connections verify against the pinned fingerprint.

| Trust policy         | Behaviour                                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"prompt"` (default) | Calls `onFirstConnection` and `onIdentityMismatch`; throws if callbacks are missing                                                                                                    |
| `"auto"`             | Trusts silently on first contact; pins automatically. On identity mismatch, silently accepts the new key and re-pins — convenient but trades MITM detection for zero-friction rotation |
| `"strict"`           | Requires the key to already be pinned; throws if not found                                                                                                                             |

With the default `trustPolicy: "prompt"`, an identity mismatch invokes the `onIdentityMismatch`
callback. If it returns `true`, the new key is **permanently re-pinned** in the `identityKeyStore`,
replacing the old key. If it returns `false`, the connection is closed — the peer transitions to
`"closed"`, not `"reconnecting"`. Choose carefully — re-pinning should only happen when the user has
out-of-band confirmation that the daemon was intentionally re-keyed.

With `trustPolicy: "strict"`, any mismatch is unconditionally fatal — the peer transitions to
`"closed"` immediately. This prevents silent MITM attacks without relying on user judgment.

***

## Key Management

`identityKeyStore` is an object you provide that persists pinned identity keys.

```typescript
interface IdentityKeyStore {
  get(daemonId: string): Promise<Uint8Array | null>;
  set(daemonId: string, publicKey: Uint8Array): Promise<void>;
  delete(daemonId: string): Promise<void>;
}
```

Minimal file-backed implementation:

```typescript
const identityKeyStore: IdentityKeyStore = {
  async get(daemonId) {
    try {
      const data = await fs.readFile(`.sideband/keys/${daemonId}`, null);
      return new Uint8Array(data);
    } catch {
      return null;
    }
  },
  async set(daemonId, publicKey) {
    await fs.mkdir(".sideband/keys", { recursive: true });
    await fs.writeFile(`.sideband/keys/${daemonId}`, publicKey);
  },
  async delete(daemonId) {
    await fs.unlink(`.sideband/keys/${daemonId}`).catch(() => {});
  },
};
```

***

## Session Pause and Resume

If the relay loses the daemon's connection (daemon restarts, network blip), the relay signals
the client session to pause rather than disconnect. During `"paused"`:

* The peer state is `"paused"` — not `"reconnecting"`.
* Outbound events are buffered (up to `eventPolicy.maxBufferedEvents`).
* RPC calls with `onDisconnect: "pause"` are buffered.
* `peer.connected` remains `true`.

When the daemon reconnects to the relay, the relay emits a resume signal and the peer
transitions back to `"active"` without a full reconnect cycle.

***

## See Also

* [Concepts — E2EE and Identity](concepts.md#e2ee-and-identity)
* `docs/protocols/sbrp/` — Full SBRP protocol specification
* `docs/protocols/sbrp/threat-model.md` — Security model and attacker assumptions
* `docs/protocols/sbrp/authentication.md` — TOFU verification detail
* `docs/sdk/peer.md` §6.9 — SBRP security model in the RFC
