# sideband

## 0.0.1

### Initial Release

- `sideband` — start a relay-connected daemon (reads API key from flag, env, or config)
- `sideband init --api-key <key>` — save API key and generate identity key pair
- Atomic config writes with `0o600` permissions (`~/.sideband/config.json`, `identity.json`)
- `--json` flag for NDJSON output (scripting/CI)
- `--version` / `--help` global flags
