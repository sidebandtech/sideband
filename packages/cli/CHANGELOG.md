# sideband

## 0.5.1

### Patch Changes

- [#46](https://github.com/sidebandtech/sideband/pull/46) [`6964d71`](https://github.com/sidebandtech/sideband/commit/6964d71c722dc7f6b679b903d38be8712fd097cf) Thanks [@koistya](https://github.com/koistya)! - Fix `npx sideband` silently exiting by resolving bin symlinks in the direct-run guard

## 0.5.0

### Minor Changes

- [#44](https://github.com/sidebandtech/sideband/pull/44) [`e6f52c4`](https://github.com/sidebandtech/sideband/commit/e6f52c42ebbba7e5649c3fa7c1263d83a53cc32a) Thanks [@koistya](https://github.com/koistya)! - Initial implementation of the `sideband` daemon CLI

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

### Patch Changes

- Updated dependencies [[`e6f52c4`](https://github.com/sidebandtech/sideband/commit/e6f52c42ebbba7e5649c3fa7c1263d83a53cc32a)]:
  - @sideband/cloud@0.5.4

## 0.0.1

### Initial Release

- `sideband` — start a relay-connected daemon (reads API key from flag, env, or config)
- `sideband init --api-key <key>` — save API key and generate identity key pair
- Atomic config writes with `0o600` permissions (`~/.sideband/config.json`, `identity.json`)
- `--json` flag for NDJSON output (scripting/CI)
- `--version` / `--help` global flags
