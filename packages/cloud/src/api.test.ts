// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  CloudApiError,
  extractDaemonIdFromToken,
  redeemQuickConnectCode,
} from "./api.js";

/** Build a minimal unsigned JWT with the given payload claims. */
function makeToken(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  return `${enc({ alg: "EdDSA" })}.${enc(payload)}.signature`;
}

describe("extractDaemonIdFromToken", () => {
  it("extracts did from a valid presence token", () => {
    const token = makeToken({ did: "d_abc123", role: "daemon" });
    expect(extractDaemonIdFromToken(token)).toBe("d_abc123");
  });

  it("throws CloudApiError for a non-JWT string", () => {
    expect(() => extractDaemonIdFromToken("notajwt")).toThrow(CloudApiError);
    expect(() => extractDaemonIdFromToken("notajwt")).toThrow("not a JWT");
  });

  it("throws CloudApiError for a two-segment string", () => {
    expect(() => extractDaemonIdFromToken("a.b")).toThrow(CloudApiError);
  });

  it("throws CloudApiError when did claim is absent", () => {
    const token = makeToken({ role: "daemon" });
    expect(() => extractDaemonIdFromToken(token)).toThrow(CloudApiError);
    expect(() => extractDaemonIdFromToken(token)).toThrow(
      "missing or empty did claim",
    );
  });

  it("throws CloudApiError when did claim is empty string", () => {
    const token = makeToken({ did: "", role: "daemon" });
    expect(() => extractDaemonIdFromToken(token)).toThrow(CloudApiError);
  });

  it("throws CloudApiError when payload is not valid JSON", () => {
    const badPayload = btoa("not-json")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    expect(() => extractDaemonIdFromToken(`header.${badPayload}.sig`)).toThrow(
      CloudApiError,
    );
  });

  it("throws with status 400 for all failure cases", () => {
    const cases = [
      "notajwt",
      makeToken({ role: "daemon" }),
      makeToken({ did: "" }),
    ];
    for (const token of cases) {
      let thrown: CloudApiError | undefined;
      try {
        extractDaemonIdFromToken(token);
      } catch (err) {
        thrown = err as CloudApiError;
      }
      expect(thrown).toBeInstanceOf(CloudApiError);
      expect(thrown!.status).toBe(400);
    }
  });
});

/** Wrap a tRPC mutation result in the plain tRPC envelope. */
function trpcOk<T>(data: T): Response {
  return Response.json({ result: { data } });
}

function trpcErr(code: string, message = "error"): Response {
  return Response.json({ error: { message, data: { code } } });
}

describe("redeemQuickConnectCode", () => {
  const origFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock(() =>
      trpcOk({
        relayUrl: "wss://relay.example.com/ws",
        token: "tok1",
        daemonId: "d_abc",
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("returns relayUrl, token, and daemonId on success", async () => {
    const result = await redeemQuickConnectCode("abcd-efgh-ijkl");
    expect(result.relayUrl).toBe("wss://relay.example.com/ws");
    expect(result.token).toBe("tok1");
    expect(result.daemonId).toBe("d_abc");
  });

  it("sends code in request body without an auth header", async () => {
    await redeemQuickConnectCode("abcd-efgh-ijkl");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      json: { code: "abcd-efgh-ijkl" },
    });
    expect(
      (init.headers as Record<string, string>)["Authorization"],
    ).toBeUndefined();
  });

  it("throws CloudApiError(404) for invalid/expired code", async () => {
    globalThis.fetch = mock(
      () => new Response("{}", { status: 404 }),
    ) as unknown as typeof fetch;
    await expect(redeemQuickConnectCode("bad-code")).rejects.toBeInstanceOf(
      CloudApiError,
    );
    const err = await redeemQuickConnectCode("bad-code").catch(
      (e) => e as CloudApiError,
    );
    expect(err.status).toBe(404);
  });

  it("throws CloudApiError(409) when daemon is offline (CONFLICT)", async () => {
    globalThis.fetch = mock(() =>
      trpcErr("CONFLICT", "daemon offline"),
    ) as unknown as typeof fetch;
    const err = await redeemQuickConnectCode("abcd-efgh-ijkl").catch(
      (e) => e as CloudApiError,
    );
    expect(err).toBeInstanceOf(CloudApiError);
    expect(err.status).toBe(409);
  });
});
