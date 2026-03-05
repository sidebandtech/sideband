---
"sideband": minor
---

Initial implementation of the `sideband` daemon CLI

`npx sideband` starts a relay-connected daemon in under 30 seconds and prints
a Quick Connect URL any browser can open to call RPC methods over E2EE.

- `sideband` — connects to relay, prints daemon ID + Quick Connect URL/code,
  registers `$sideband/echo` and `$sideband/info` built-in RPC handlers,
  auto-renews QC codes (exp. backoff on failure), graceful SIGINT/SIGTERM shutdown
- `sideband init --api-key <key>` — validates key, saves config, generates Ed25519 identity keypair
- `--json` — NDJSON output for scripting/CI (`ready`, `connected`, `rpc`, `disconnected`,
  `quick_connect`, `error` events)
- API key resolution: `--api-key` flag > `SIDEBAND_API_KEY` env > `~/.sideband/config.json`
- Config and identity files written atomically with `0o600` permissions
