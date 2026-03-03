// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
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

/** Wrap a tRPC mutation result in the plain tRPC envelope. */
function trpcOk<T>(data: T): Response {
  return Response.json({ result: { data } });
}

// identityKeyPair is only needed after the first relay connection —
// all startup-error tests reject before reaching that point.
const fakeKeyPair = {} as never;

describe("listen() — startup error paths", () => {
  const origFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock(() =>
      Promise.resolve(new Response(null, { status: 500 })),
    );
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("rejects immediately with AbortError when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      listen({
        apiKey: "sbnd_dak_test",
        identityKeyPair: fakeKeyPair,
        onConnection: () => {},
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects with CloudApiError(400) when daemonId mismatches the token did claim", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve(trpcOk({ presenceToken: makeToken({ did: "d_real" }) })),
    );
    await expect(
      listen({
        apiKey: "sbnd_dak_test",
        daemonId: "d_wrong",
        identityKeyPair: fakeKeyPair,
        onConnection: () => {},
      }),
    ).rejects.toMatchObject({ name: "CloudApiError", status: 400 });
  });

  it("rejects immediately on fatal 401 and does not retry", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve(new Response(null, { status: 401 })),
    );
    await expect(
      listen({
        apiKey: "sbnd_dak_invalid",
        identityKeyPair: fakeKeyPair,
        onConnection: () => {},
      }),
    ).rejects.toMatchObject({ name: "CloudApiError", status: 401 });
    // Fatal credential failure — the loop must not retry.
    expect(fetchMock.mock.calls.length).toBe(1);
  });
});
