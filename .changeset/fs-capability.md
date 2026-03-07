---
"sideband": patch
---

Add `$sideband/fs.*` file browser capability behind `--dir <path>` flag.

- `$sideband/fs.list` — directory listing with stat metadata, dotfile filtering, 1000-entry cap
- `$sideband/fs.read` — bounded file preview (512 KiB); text as UTF-8, images/binaries as base64
- `--allow-dotfiles` — opt-in dotfile access (requires `--dir`)
- Path traversal prevention: POSIX normalization, dual absolute-path rejection, symlink containment via `path.relative()`
- Binary files over 512 KiB return `content: ""` — no corrupted partial binaries transmitted
- `capabilities.fs = { name, write: false }` added to `$sideband/info` when `--dir` is set
- Startup output includes active capability list (e.g. `Capabilities: stats, fs (my-app)`)
