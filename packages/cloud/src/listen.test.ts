// SPDX-License-Identifier: Apache-2.0

import type { Server } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import { listen } from "./listen.js";

/** Build a minimal unsigned JWT with the given payload claims. */
function makeToken(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  return `${enc({ alg: "EdDSA" })}.${enc(payload)}.signature`;
}

/** Wrap a tRPC mutation result in the expected envelope. */
function trpcOk<T>(data: T): Response {
  return Response.json({ result: { data: { json: data } } });
}

// identityKeyPair is only needed after the first relay connection —
// all startup-error tests reject before reaching that point.
const fakeKeyPair = {} as never;

describe("listen() — startup error paths", () => {
  let server: Server | undefined;
  afterEach(() => server?.stop(true));

  it("rejects immediately with AbortError when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      listen({
        apiKey: "dak_test",
        identityKeyPair: fakeKeyPair,
        onConnection: () => {},
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects with CloudApiError(400) when daemonId mismatches the token did claim", async () => {
    // Return a token whose `did` claim is "d_real" — not "d_wrong".
    server = Bun.serve({
      port: 0,
      fetch: () => trpcOk({ presenceToken: makeToken({ did: "d_real" }) }),
    });
    await expect(
      listen({
        apiKey: "dak_test",
        daemonId: "d_wrong",
        identityKeyPair: fakeKeyPair,
        onConnection: () => {},
        apiUrl: `http://localhost:${server.port}`,
      }),
    ).rejects.toMatchObject({ name: "CloudApiError", status: 400 });
  });

  it("rejects immediately on fatal 401 and does not retry", async () => {
    let calls = 0;
    server = Bun.serve({
      port: 0,
      fetch: () => {
        calls++;
        return new Response(null, { status: 401 });
      },
    });
    await expect(
      listen({
        apiKey: "dak_invalid",
        identityKeyPair: fakeKeyPair,
        onConnection: () => {},
        apiUrl: `http://localhost:${server.port}`,
      }),
    ).rejects.toMatchObject({ name: "CloudApiError", status: 401 });
    // Fatal credential failure — the loop must not retry.
    expect(calls).toBe(1);
  });
});
