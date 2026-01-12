# Transport Conformance

> **Authority**: Primary (Normative)
> **Purpose**: Conformance test matrix and harness specification for transport implementations.
> **See also**: transport/abi.md, transport/errors.md, transport/websocket.md

This document defines the conformance requirements and test infrastructure for transport implementations. All transports (`browser`, `node`, `memory`) must pass the applicable tests to be considered conformant.

## 1. Test Matrix

The matrix uses requirement levels:

- **MUST** — Required for conformance; test failure blocks release
- **SHOULD** — Strongly recommended; failure requires documented justification
- **N/A** — Not applicable to this transport

### 1.1 Lifecycle Tests

| Test                                               | browser | node | memory | Notes                                                             |
| -------------------------------------------------- | ------- | ---- | ------ | ----------------------------------------------------------------- |
| Connect returns valid connection                   | MUST    | MUST | MUST   | Connection has valid `id`, `endpoint`, `inbound`, `send`, `close` |
| Connect rejects invalid endpoint                   | MUST    | MUST | MUST   | Invalid URL format, unreachable host                              |
| Connect respects timeout                           | MUST    | MUST | SHOULD | `timeoutMs` option honored                                        |
| Connect rejects with kind `aborted` on AbortSignal | MUST    | MUST | SHOULD | `signal` option cancels in-flight connect                         |
| Connect fails on subprotocol mismatch              | MUST    | MUST | N/A    | Server doesn't accept requested subprotocol                       |
| State transitions correctly                        | MUST    | MUST | MUST   | `connecting` -> `open` -> `closing` -> `closed`                   |
| Listen returns listener                            | N/A     | MUST | MUST   | Browser cannot listen                                             |
| Close is idempotent                                | MUST    | MUST | MUST   | Multiple `close()` calls succeed                                  |

### 1.2 Data Transfer Tests

| Test                                   | browser | node | memory | Notes                                       |
| -------------------------------------- | ------- | ---- | ------ | ------------------------------------------- |
| Send delivers bytes                    | MUST    | MUST | MUST   | Sent bytes received intact                  |
| Order preserved                        | MUST    | MUST | MUST   | Sequential sends arrive in order            |
| Large messages (64 KB)                 | MUST    | MUST | MUST   | 65536-byte message transfers correctly      |
| Max message size (1 MiB boundary)      | MUST    | MUST | MUST   | 1048576 bytes succeeds; 1048577 fails       |
| Concurrent sends preserve order        | MUST    | MUST | MUST   | Parallel `send()` calls maintain call order |
| Buffered messages delivered post-close | MUST    | MUST | MUST   | In-flight messages drain before completion  |

### 1.3 Error Handling Tests

| Test                               | browser | node | memory | Notes                                                 |
| ---------------------------------- | ------- | ---- | ------ | ----------------------------------------------------- |
| Send after close rejects           | MUST    | MUST | MUST   | `send()` on closed connection throws `TransportError` |
| Inbound completes after close      | MUST    | MUST | MUST   | Iterator yields `done: true` on graceful close        |
| Text frame triggers error          | MUST    | MUST | N/A    | WebSocket text frames rejected with code 1003         |
| Handler throw doesn't crash server | N/A     | MUST | MUST   | Exception in `ConnectionHandler` logs, closes conn    |

### 1.4 Iterator Semantics Tests

| Test                                  | browser | node   | memory | Notes                                           |
| ------------------------------------- | ------- | ------ | ------ | ----------------------------------------------- |
| Single consumer enforced              | MUST    | MUST   | MUST   | Second iterator throws `TransportError`         |
| Early break doesn't close connection  | MUST    | MUST   | MUST   | `break` from `for await` leaves connection open |
| Resumes and drains buffer after break | SHOULD  | SHOULD | MUST   | Subsequent iteration yields buffered messages   |

---

## 2. Test Harness Specification

The `@sideband/testing` package provides a harness abstraction for running conformance tests against any transport implementation.

### 2.1 Core Interfaces

```typescript
import type {
  Transport,
  TransportConnection,
  TransportListener,
  TransportEndpoint,
  ConnectionHandler,
} from "@sideband/transport";
import type { TransportError } from "@sideband/transport/errors";

/**
 * Echo server that reflects received messages back to sender.
 */
export interface EchoServer {
  /** Endpoint clients should connect to */
  readonly endpoint: TransportEndpoint;
  /** Number of messages echoed */
  readonly messageCount: number;
  /** Stop the echo server */
  close(): Promise<void>;
}

/**
 * Injection point for simulating transport failures.
 */
export type ErrorInjectionPoint = "send" | "receive" | "connect";

/**
 * Test harness for a specific transport implementation.
 * Each transport provides its own harness implementation.
 */
export interface TransportTestHarness {
  /** The transport under test */
  readonly transport: Transport;

  /**
   * Create an echo server that reflects all received messages.
   * Useful for round-trip tests.
   */
  createEchoServer(): Promise<EchoServer>;

  /**
   * Create a server with custom connection handling.
   * @param handler Called for each accepted connection
   */
  createServer(handler: ConnectionHandler): Promise<TransportListener>;

  /**
   * Inject an error at the specified point.
   * Next operation at that point will fail with the given error.
   * @param point Where to inject the error
   * @param error The error to throw
   */
  injectError(point: ErrorInjectionPoint, error: TransportError): void;

  /**
   * Simulate an abrupt disconnection (network failure).
   * @param conn The connection to disconnect
   */
  simulateDisconnect(conn: TransportConnection): Promise<void>;

  /**
   * Clean up all resources created by this harness.
   * Must be called after each test or test suite.
   */
  cleanup(): Promise<void>;
}
```

### 2.2 Suite Factory

````typescript
/**
 * Creates the conformance test suite for a transport.
 * Uses the test framework's native describe/it functions.
 *
 * @param harness Transport-specific test harness
 * @param options Optional configuration
 *
 * @example
 * ```typescript
 * import { createConformanceSuite } from "@sideband/testing";
 * import { createNodeHarness } from "@sideband/testing/node";
 *
 * describe("node:ws transport conformance", () => {
 *   const harness = createNodeHarness();
 *   createConformanceSuite(harness, { skip: ["subprotocol"] });
 *   afterAll(() => harness.cleanup());
 * });
 * ```
 */
export function createConformanceSuite(
  harness: TransportTestHarness,
  options?: ConformanceSuiteOptions,
): void;

export interface ConformanceSuiteOptions {
  /**
   * Test categories to skip (e.g., ["subprotocol", "listen"]).
   * Use for transports where certain tests are N/A.
   */
  skip?: string[];

  /**
   * Timeout for individual tests in milliseconds.
   * Default: 5000
   */
  testTimeout?: number;

  /**
   * Message sizes to test in large message tests.
   * Default: [64 * 1024, 1024 * 1024]
   */
  messageSizes?: number[];
}
````

### 2.3 Harness Factories

Each transport package exports a harness factory:

```typescript
// @sideband/testing/memory
export function createMemoryHarness(): TransportTestHarness;

// @sideband/testing/node
export function createNodeHarness(
  options?: NodeHarnessOptions,
): TransportTestHarness;

export interface NodeHarnessOptions {
  /** Port range for test servers. Default: 49152-65535 */
  portRange?: [number, number];
  /** Host to bind test servers. Default: "127.0.0.1" */
  host?: string;
}

// @sideband/testing/browser (for Playwright)
export function createBrowserHarness(
  page: Page,
  serverEndpoint: TransportEndpoint,
): TransportTestHarness;
```

---

## 3. Interoperability Tests

Browser-Node interoperability requires a test setup where a Node server runs and a Playwright-controlled browser connects to it.

### 3.1 Test Scenarios

| Test                                | Description                                         |
| ----------------------------------- | --------------------------------------------------- |
| Browser connects to Node server     | Establish WebSocket connection from browser to Node |
| Bidirectional message exchange      | Send messages both directions, verify receipt       |
| Close propagation: client to server | Browser closes, Node sees clean close               |
| Close propagation: server to client | Node closes, browser sees close event               |
| Large message transfer (1 MiB)      | Transfer 1 MiB payload in each direction            |
| Concurrent connections              | Multiple browser tabs connect to same server        |
| Reconnection after disconnect       | Browser reconnects after server-initiated close     |

### 3.2 Playwright Test Structure

```typescript
import { test, expect } from "@playwright/test";
import { createNodeServer } from "@sideband/testing/node";
import type { TransportEndpoint } from "@sideband/transport";

let serverEndpoint: TransportEndpoint;

test.beforeAll(async () => {
  // Start Node server
  const server = await createNodeServer({ port: 0 });
  serverEndpoint = server.endpoint;
});

test.afterAll(async () => {
  // Cleanup
});

test("browser connects to node server", async ({ page }) => {
  await page.goto("/test-page.html");

  // Inject test code into browser context
  const result = await page.evaluate(async (endpoint) => {
    const { BrowserTransport } = await import("@sideband/transport-browser");
    const transport = new BrowserTransport();
    const conn = await transport.connect(endpoint);
    const success = conn.id !== undefined;
    await conn.close();
    return success;
  }, serverEndpoint);

  expect(result).toBe(true);
});

test("bidirectional message exchange", async ({ page }) => {
  await page.goto("/test-page.html");

  const result = await page.evaluate(async (endpoint) => {
    const { BrowserTransport } = await import("@sideband/transport-browser");
    const transport = new BrowserTransport();
    const conn = await transport.connect(endpoint);

    // Send message
    const sent = new TextEncoder().encode("hello");
    await conn.send(sent);

    // Receive echo
    for await (const received of conn.inbound) {
      await conn.close();
      return new TextDecoder().decode(received) === "hello";
    }
    return false;
  }, serverEndpoint);

  expect(result).toBe(true);
});

test("large message transfer (1 MiB)", async ({ page }) => {
  await page.goto("/test-page.html");

  const result = await page.evaluate(async (endpoint) => {
    const { BrowserTransport } = await import("@sideband/transport-browser");
    const transport = new BrowserTransport();
    const conn = await transport.connect(endpoint);

    // Send 1 MiB message
    const size = 1024 * 1024;
    const sent = new Uint8Array(size);
    crypto.getRandomValues(sent);
    await conn.send(sent);

    // Receive echo and verify
    for await (const received of conn.inbound) {
      const match =
        received.length === size && received.every((b, i) => b === sent[i]);
      await conn.close();
      return match;
    }
    return false;
  }, serverEndpoint);

  expect(result).toBe(true);
});
```

---

## 4. Implementation Notes

### 4.1 Package Location

Conformance tests and harnesses live in `@sideband/testing`:

```text
packages/testing/
  src/
    harness.ts          # TransportTestHarness interface
    suite.ts            # createConformanceSuite implementation
    memory.ts           # Memory transport harness
    node.ts             # Node transport harness
    browser.ts          # Browser harness (Playwright helper)
    interop/            # Interoperability test utilities
  tests/
    memory.test.ts      # Memory conformance tests
    node.test.ts        # Node conformance tests
    interop.test.ts     # Playwright interop tests
```

### 4.2 Running Tests

```bash
# Run all conformance tests
bun test packages/testing

# Run specific transport
bun test packages/testing/tests/memory.test.ts
bun test packages/testing/tests/node.test.ts

# Run interop tests (requires Playwright)
bun playwright test packages/testing/tests/interop.test.ts
```

### 4.3 CI/CD Integration

Add to GitHub Actions workflow:

```yaml
# .github/workflows/test.yml
jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Memory transport conformance
        run: bun test packages/testing/tests/memory.test.ts

      - name: Node transport conformance
        run: bun test packages/testing/tests/node.test.ts

  interop:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Install Playwright
        run: bunx playwright install --with-deps chromium

      - name: Browser-Node interop tests
        run: bun playwright test packages/testing/tests/interop.test.ts
```

### 4.4 Adding New Transport Conformance

To add conformance tests for a new transport:

1. Create harness factory in `packages/testing/src/<transport>.ts`
2. Implement `TransportTestHarness` interface
3. Create test file in `packages/testing/tests/<transport>.test.ts`
4. Call `createConformanceSuite()` with appropriate skip list
5. Add to CI workflow

Example for a hypothetical QUIC transport:

```typescript
// packages/testing/src/quic.ts
import type { TransportTestHarness } from "./harness.js";
import { QuicTransport } from "@sideband/transport-quic";

export function createQuicHarness(): TransportTestHarness {
  const transport = new QuicTransport();
  const servers: TransportListener[] = [];

  return {
    transport,

    async createEchoServer() {
      // Implementation
    },

    async createServer(handler) {
      // Implementation
    },

    injectError(point, error) {
      // Implementation (may be no-op for real transports)
    },

    async simulateDisconnect(conn) {
      // Implementation
    },

    async cleanup() {
      for (const server of servers) {
        await server.close();
      }
      servers.length = 0;
    },
  };
}
```

```typescript
// packages/testing/tests/quic.test.ts
import { describe, afterAll } from "bun:test";
import { createConformanceSuite } from "../src/suite.js";
import { createQuicHarness } from "../src/quic.js";

describe("quic transport conformance", () => {
  const harness = createQuicHarness();

  createConformanceSuite(harness, {
    // Skip browser-only or N/A tests
    skip: ["text-frame"],
  });

  afterAll(() => harness.cleanup());
});
```
