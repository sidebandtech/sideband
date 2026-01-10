# @sideband/transport-node

Node.js and Bun transport for Sideband.

> **Not yet implemented.** This package is a placeholder for the planned Node/Bun WebSocket transport.

## Planned Features

- WebSocket server and client via `ws` or Bun.serve()
- `Transport` implementation for services and workers
- Connection management and error recovery
- TLS support for secure connections

## Install

```bash
bun add @sideband/transport-node
```

Will implement the `Transport` interface from [`@sideband/transport`](https://www.npmjs.com/package/@sideband/transport). For browser environments, see [`@sideband/transport-browser`](https://www.npmjs.com/package/@sideband/transport-browser).

## License

Apache-2.0
