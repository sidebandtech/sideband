# sideband

Developer CLI for [Sideband](https://sideband.tech). Run `npx sideband` to get a Quick Connect URL — any browser can open it and start calling RPC methods over E2EE.

## Install

```bash
npm i -g sideband   # global install; npx/bunx work without installing
```

## Setup

Get an API key from [sideband.cloud](https://sideband.cloud), then save it:

```bash
sideband init --api-key sbnd_dak_...
```

This validates the key, saves it to `~/.sideband/config.json`, and generates an Ed25519 identity keypair in `~/.sideband/identity.json` (if not already present). Both files are written with `0o600` permissions.

## Usage

```bash
sideband                          # start daemon
sideband --api-key sbnd_dak_...   # override saved/env API key
sideband --json                   # NDJSON output for scripting/CI
sideband init --api-key <key>     # save API key
sideband --version                # print version
sideband --help                   # show help
```

```text
$ npx sideband

  Sideband daemon running
  Daemon ID: d_8f3kN2p
  Relay:     wss://relay.sideband.cloud

  Quick Connect: https://sideband.cloud/connect#qc=abcd-efgh-ijkl
  Code:          abcd-efgh-ijkl

  Scan to connect:
  ████████████████████████████████
  ██ ▄▄▄▄▄ █▀▄ █▄▀▄▀▄▄▀ █ ▄▄▄▄▄ ██
  ██ █   █ █▀▀▄█▄▄█▄▀ ▀▄█ █   █ ██
  ██ █▄▄▄█ █▀▄▀▄▀▀▄▀▄▄▄▀█ █▄▄▄█ ██
  ██▄▄▄▄▄▄▄█▄█ █▄▀▄▄█ █ █▄▄▄▄▄▄▄██
  ████████████████████████████████

  Waiting for connections...

  + Connected (8f3kN2p1) [12:34:05]
  ← echo: hello [12:34:06]
  → $sideband/info [12:34:07]
  - Disconnected (8f3kN2p1) [12:34:12]
```

A QR code is rendered below the Quick Connect URL when the terminal is wide enough to fit
it without line-wrapping (skipped silently otherwise). In `--json` mode, QR rendering is
disabled — use the `quickConnectUrl` field from the `ready` event instead.

## API key resolution

Highest priority wins:

1. `--api-key` flag
2. `SIDEBAND_API_KEY` environment variable
3. `~/.sideband/config.json`

Override the config directory with `SIDEBAND_HOME`.

## Built-in RPC methods

Two methods are always available under the reserved `$sideband/` namespace:

| Method           | Returns                                         |
| ---------------- | ----------------------------------------------- |
| `$sideband/echo` | The input unchanged — validates RPC round-trip  |
| `$sideband/info` | Daemon metadata (ID, version, platform, uptime) |

## JSON mode

`--json` emits NDJSON to stdout (one event per line). The first line is always a `ready` event:

```jsonl
{"event":"ready","daemonId":"d_8f3kN2p","cliVersion":"0.5.0","configDir":"/home/user/.sideband","relayUrl":"wss://relay.sideband.cloud","quickConnectCode":"abcd-efgh-ijkl","quickConnectUrl":"https://sideband.cloud/connect#qc=abcd-efgh-ijkl"}
{"event":"connected","peerId":"peer_abc123"}
{"event":"rpc","peerId":"peer_abc123","method":"$sideband/echo","data":"hello"}
{"event":"disconnected","peerId":"peer_abc123"}
{"event":"quick_connect","code":"mnop-qrst-uvwx","url":"https://sideband.cloud/connect#qc=mnop-qrst-uvwx","expiresAt":"2026-03-05T12:44:05Z"}
{"event":"error","message":"Quick Connect renewal failed: rate limited"}
```

In human mode, errors go to stderr. In `--json` mode, errors are emitted as
`{ event: "error" }` to stdout (authoritative for automation) and also written to stderr
as a human-readable mirror.

## Quick Connect renewal

QC codes expire after 5 minutes. The CLI renews automatically 30 seconds before expiry with exponential backoff on failure (1s–30s). Existing connections are unaffected by renewal failures.

## License

Apache-2.0
