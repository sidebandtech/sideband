# sideband

## 0.6.2

### Patch Changes

- [#56](https://github.com/sidebandtech/sideband/pull/56) [`00fca3e`](https://github.com/sidebandtech/sideband/commit/00fca3eadceb2bb92990e0fbcd608ea5ceae232c) Thanks [@koistya](https://github.com/koistya)! - Print a QR code in the terminal at daemon startup alongside the Quick Connect URL.
  - Renders below the URL/code block using Unicode half-block characters (`▀▄█ `) — halves
    the height vs full-size QR, works on light and dark terminals without ANSI color codes
  - Skipped when the terminal is too narrow to fit the QR without line-wrapping (dynamic
    guard based on actual matrix width + 2-char left margin)
  - Silently skipped on error — QR rendering never blocks startup
  - Not reprinted on QC renewal (would spam the terminal); only URL + code are shown
  - Zero new transitive dependencies (`qr` package, 0 deps, 7 KB gzipped)

- Updated dependencies [[`00fca3e`](https://github.com/sidebandtech/sideband/commit/00fca3eadceb2bb92990e0fbcd608ea5ceae232c)]:
  - @sideband/cloud@0.6.1

## 0.6.1

### Patch Changes

- [#54](https://github.com/sidebandtech/sideband/pull/54) [`ea8661b`](https://github.com/sidebandtech/sideband/commit/ea8661b2fd7e150462e69ffabf6472c99acb94e1) Thanks [@koistya](https://github.com/koistya)! - Add `$sideband/fs.*` file browser capability behind `--dir <path>` flag.
  - `$sideband/fs.list` — directory listing with stat metadata, dotfile filtering, 1000-entry cap
  - `$sideband/fs.read` — bounded file preview (512 KiB); text as UTF-8, images/binaries as base64
  - `--allow-dotfiles` — opt-in dotfile access (requires `--dir`)
  - Path traversal prevention: POSIX normalization, dual absolute-path rejection, symlink containment via `path.relative()`
  - Binary files over 512 KiB return `content: ""` — no corrupted partial binaries transmitted
  - `capabilities.fs = { name, write: false }` added to `$sideband/info` when `--dir` is set
  - Startup output includes active capability list (e.g. `Capabilities: stats, fs (my-app)`)

## 0.6.0

### Minor Changes

- [#52](https://github.com/sidebandtech/sideband/pull/52) [`410de06`](https://github.com/sidebandtech/sideband/commit/410de0691fb6a03a0f6241a7fb2de77df614afdf) Thanks [@koistya](https://github.com/koistya)! - Add built-in daemon capabilities: `$sideband/stats` snapshot and live subscription, `$sideband/rpc.list` / `$sideband/rpc.describe` method introspection, `--name` CLI flag, and `capabilities` + `name` fields in `$sideband/info`. Adds `RpcInterface.listMethods()` to the peer SDK. Renames `AcceptedPeer` → `ConnectedPeer` and `CloudPeerServer` → `CloudServer`.

### Patch Changes

- Updated dependencies [[`410de06`](https://github.com/sidebandtech/sideband/commit/410de0691fb6a03a0f6241a7fb2de77df614afdf)]:
  - @sideband/cloud@0.6.0

## 0.5.2

### Patch Changes

- [#50](https://github.com/sidebandtech/sideband/pull/50) [`420ed6f`](https://github.com/sidebandtech/sideband/commit/420ed6f67a0de209c342d74c5542a2f4502d6ba6) Thanks [@koistya](https://github.com/koistya)! - Polish CLI output: consistent sigils, short peer IDs, dedicated echo handler, QC expiry to stdout

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
