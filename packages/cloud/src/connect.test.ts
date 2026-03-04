// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { PeerError, PeerErrorCode } from "@sideband/peer";
import { CloudApiError } from "./api.js";
import { CloudClientNegotiator } from "./connect.js";

const mockIdentityKeyStore = {
  load: async () => null,
  save: async () => {},
} as never;

function trpcOk<T>(data: T): Response {
  return Response.json({ result: { data } });
}

function trpcErr(code: string, message = "error"): Response {
  return Response.json({ error: { message, data: { code } } });
}

// Returns a fresh Response each time — Response body can only be read once.
const makeRedeemOk = () =>
  trpcOk({
    relayUrl: "wss://relay.example.com/ws",
    token: "tok1",
    daemonId: "d_abc",
  });

describe("CloudClientNegotiator — QC path", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(makeRedeemOk) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("redeems code and returns endpoint with token on first call", async () => {
    const neg = new CloudClientNegotiator({
      quickConnectCode: "abcd-efgh-ijkl",
      identityKeyStore: mockIdentityKeyStore,
    });
    const params = await neg.getConnectionParams();
    expect(params.endpoint).toContain("wss://relay.example.com/ws");
    expect(new URL(params.endpoint).searchParams.get("token")).toBe("tok1");
  });

  it("is one-shot: second getConnectionParams() throws PeerError(InvalidState)", async () => {
    const neg = new CloudClientNegotiator({
      quickConnectCode: "abcd-efgh-ijkl",
      identityKeyStore: mockIdentityKeyStore,
    });
    await neg.getConnectionParams();
    await expect(neg.getConnectionParams()).rejects.toMatchObject({
      code: PeerErrorCode.InvalidState,
    });
  });

  it("does not call fetch a second time (short-circuits on qcRedeemed)", async () => {
    const fetchMock = mock(makeRedeemOk);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const neg = new CloudClientNegotiator({
      quickConnectCode: "abcd-efgh-ijkl",
      identityKeyStore: mockIdentityKeyStore,
    });
    await neg.getConnectionParams();
    await neg.getConnectionParams().catch(() => {});
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it("resolves daemonId from redeem response", async () => {
    // QC clients don't know daemonId upfront — it comes from the server.
    const neg = new CloudClientNegotiator({
      quickConnectCode: "abcd-efgh-ijkl",
      identityKeyStore: mockIdentityKeyStore,
    });
    await neg.getConnectionParams();
    expect(neg["resolvedDaemonId"]).toBe("d_abc");
  });

  it("classifies 409 as fatal — code is burned (server consumes before offline check)", async () => {
    // The server atomically transitions pending→redeemed before checking daemon
    // status (consume-first design). 409 always means the code is already burned.
    globalThis.fetch = mock(() =>
      trpcErr("CONFLICT", "daemon offline"),
    ) as unknown as typeof fetch;

    const neg = new CloudClientNegotiator({
      quickConnectCode: "abcd-efgh-ijkl",
      identityKeyStore: mockIdentityKeyStore,
    });

    const err = await neg
      .getConnectionParams()
      .catch((e) => e as CloudApiError);
    expect(err).toBeInstanceOf(CloudApiError);
    expect(err.status).toBe(409);
    // Must be fatal so the peer surfaces the true cause instead of retrying into a 404.
    expect(neg.classifyError(err)).toBe("fatal");
  });

  it("failed redeem allows retry — does not short-circuit to InvalidState", async () => {
    // A non-burning failure (404 — code not found/expired) must not lock out further
    // attempts. Both calls must reach the API, not throw PeerError(InvalidState).
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls++;
      return trpcErr("NOT_FOUND", "code expired");
    }) as unknown as typeof fetch;
    const neg = new CloudClientNegotiator({
      quickConnectCode: "abcd-efgh-ijkl",
      identityKeyStore: mockIdentityKeyStore,
    });
    await neg.getConnectionParams().catch(() => {});
    await neg.getConnectionParams().catch(() => {});
    expect(calls).toBe(2);
  });
});

describe("CloudClientNegotiator — account path", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("fetches a fresh relay session on each getConnectionParams() call", async () => {
    const session = {
      relayUrl: "wss://relay.example.com/ws",
      token: "sess-tok",
    };
    const fetchMock = mock(() => trpcOk(session));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const neg = new CloudClientNegotiator({
      daemonId: "d_abc",
      getAccessToken: () => "user-token",
      identityKeyStore: mockIdentityKeyStore,
    });
    const params = await neg.getConnectionParams();
    expect(params.endpoint).toContain("wss://relay.example.com/ws");
    expect(new URL(params.endpoint).searchParams.get("token")).toBe("sess-tok");
    // A second attempt fetches a new session (relay rejects reused sessionIds).
    globalThis.fetch = mock(() =>
      trpcOk({ relayUrl: "wss://relay.example.com/ws", token: "sess-tok-2" }),
    ) as unknown as typeof fetch;
    const params2 = await neg.getConnectionParams();
    expect(new URL(params2.endpoint).searchParams.get("token")).toBe(
      "sess-tok-2",
    );
  });
});

describe("CloudClientNegotiator — classifyError", () => {
  const negQc = new CloudClientNegotiator({
    quickConnectCode: "abcd-efgh-ijkl",
    identityKeyStore: mockIdentityKeyStore,
  });
  const negAccount = new CloudClientNegotiator({
    daemonId: "d_abc",
    getAccessToken: () => "token",
    identityKeyStore: mockIdentityKeyStore,
  });

  it("classifies PeerError(InvalidState) as fatal", () => {
    expect(
      negQc.classifyError(new PeerError(PeerErrorCode.InvalidState, "test")),
    ).toBe("fatal");
  });

  it("classifies CloudApiError(404) as fatal", () => {
    expect(negQc.classifyError(new CloudApiError(404, "not found"))).toBe(
      "fatal",
    );
  });

  it("classifies CloudApiError(409) as fatal in QC mode (code burned by server)", () => {
    expect(negQc.classifyError(new CloudApiError(409, "conflict"))).toBe(
      "fatal",
    );
  });

  it("classifies CloudApiError(409) as retryable in account mode (ghost-socket collision)", () => {
    expect(negAccount.classifyError(new CloudApiError(409, "conflict"))).toBe(
      "retryable",
    );
  });

  it("classifies CloudApiError(500) as retryable", () => {
    expect(negQc.classifyError(new CloudApiError(500, "server error"))).toBe(
      "retryable",
    );
  });
});
