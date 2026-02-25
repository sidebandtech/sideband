// SPDX-License-Identifier: Apache-2.0

/**
 * Type-level tests for the peer public API contracts.
 *
 * All assertions use type-level extraction (no runtime calls on undefined values)
 * so they pass under both `bun test` and `tsc --noEmit`.
 */

import type { NegotiationResult, SessionSignal } from "@sideband/runtime";
import { describe, expectTypeOf, test } from "bun:test";
import { PeerError, PeerErrorCode } from "./errors.js";
import type { listen } from "./listen.js";
import type {
  AcceptedPeer,
  EventsInterface,
  ListenOptions,
  Peer,
  PeerEvents,
  PeerServer,
  PeerState,
  RpcCallOptions,
  RpcInterface,
  TryCallResult,
  TypedRpcClient,
  Unsubscribe,
} from "./types.js";

// ─── TypedRpcClient ───────────────────────────────────────────────────────────

describe("TypedRpcClient", () => {
  interface Api {
    greet: (params: { name: string }) => string;
    ping: (params: void) => void;
    sum: (params: number[]) => number;
  }

  type Client = TypedRpcClient<Api>;

  test("regular-params method: correct parameter and return types", () => {
    expectTypeOf<Parameters<Client["greet"]>>().toEqualTypeOf<
      [{ name: string }, RpcCallOptions?]
    >();
    expectTypeOf<ReturnType<Client["greet"]>>().toEqualTypeOf<
      Promise<string>
    >();
  });

  test("void-params method: returns Promise<void>", () => {
    expectTypeOf<ReturnType<Client["ping"]>>().toEqualTypeOf<Promise<void>>();
  });

  test("void-params method: first arg is optional undefined", () => {
    expectTypeOf<Parameters<Client["ping"]>[0]>().toEqualTypeOf<undefined>();
  });

  test("void-params method: second arg is optional RpcCallOptions", () => {
    expectTypeOf<Parameters<Client["ping"]>[1]>().toEqualTypeOf<
      RpcCallOptions | undefined
    >();
  });

  test("zero-arg method support: () => R treated as void-params", () => {
    interface ZeroArg {
      noop: () => string;
    }
    type ZeroClient = TypedRpcClient<ZeroArg>;
    expectTypeOf<ReturnType<ZeroClient["noop"]>>().toEqualTypeOf<
      Promise<string>
    >();
    // First param must be optional (undefined) for zero-arg methods
    expectTypeOf<
      Parameters<ZeroClient["noop"]>[0]
    >().toEqualTypeOf<undefined>();
  });

  test("non-function keys are excluded from typed client", () => {
    interface MixedApi {
      "user.get": (params: { id: string }) => string;
      version: string;
      count: number;
    }
    type Client = TypedRpcClient<MixedApi>;
    // Only method keys survive — non-function keys are excluded entirely
    expectTypeOf<keyof Client>().toEqualTypeOf<"user.get">();
  });
});

// ─── PeerEvents ───────────────────────────────────────────────────────────────

describe("PeerEvents", () => {
  test("void lifecycle events carry void payload", () => {
    expectTypeOf<PeerEvents["connected"]>().toBeVoid();
    expectTypeOf<PeerEvents["disconnected"]>().toBeVoid();
    expectTypeOf<PeerEvents["reconnecting"]>().toBeVoid();
    expectTypeOf<PeerEvents["sessionPaused"]>().toBeVoid();
    expectTypeOf<PeerEvents["sessionResumed"]>().toBeVoid();
  });

  test("stateChange carries full state transition", () => {
    expectTypeOf<PeerEvents["stateChange"]>().toEqualTypeOf<{
      state: PeerState;
      previous: PeerState;
    }>();
  });

  test("error event carries Error", () => {
    expectTypeOf<PeerEvents["error"]>().toEqualTypeOf<Error>();
  });
});

// ─── TryCallResult ────────────────────────────────────────────────────────────

describe("TryCallResult", () => {
  test("ok branch exposes value; error branch exposes PeerError", () => {
    type OkBranch = Extract<TryCallResult<number>, { ok: true }>;
    type ErrBranch = Extract<TryCallResult<number>, { ok: false }>;
    expectTypeOf<OkBranch["value"]>().toBeNumber();
    expectTypeOf<OkBranch["reconnected"]>().toBeBoolean();
    expectTypeOf<ErrBranch["error"]>().toEqualTypeOf<PeerError>();
    expectTypeOf<ErrBranch["reconnected"]>().toBeBoolean();
  });
});

// ─── Subscription return types ────────────────────────────────────────────────

describe("subscription return types", () => {
  test("peer.on returns Unsubscribe", () => {
    expectTypeOf<ReturnType<Peer["on"]>>().toEqualTypeOf<Unsubscribe>();
  });

  test("rpc.handle returns Unsubscribe", () => {
    expectTypeOf<
      ReturnType<RpcInterface["handle"]>
    >().toEqualTypeOf<Unsubscribe>();
  });

  test("events.on and onPattern return Unsubscribe", () => {
    expectTypeOf<
      ReturnType<EventsInterface["on"]>
    >().toEqualTypeOf<Unsubscribe>();
    expectTypeOf<
      ReturnType<EventsInterface["onPattern"]>
    >().toEqualTypeOf<Unsubscribe>();
  });
});

// ─── PeerState ────────────────────────────────────────────────────────────────

describe("PeerState", () => {
  test('"paused" is a valid PeerState', () => {
    expectTypeOf<"paused">().toMatchTypeOf<PeerState>();
  });
});

// ─── AcceptedPeer ─────────────────────────────────────────────────────────────

describe("AcceptedPeer", () => {
  test("state is narrower than PeerState", () => {
    expectTypeOf<AcceptedPeer["state"]>().toEqualTypeOf<
      "active" | "paused" | "closed"
    >();
  });

  test("has no connect() method", () => {
    expectTypeOf<AcceptedPeer>().not.toHaveProperty("connect");
  });

  test("has no reconnecting promise", () => {
    expectTypeOf<AcceptedPeer>().not.toHaveProperty("reconnecting");
  });
});

// ─── PeerErrorCode ────────────────────────────────────────────────────────────

describe("PeerErrorCode", () => {
  test("SessionPaused is the literal string session_paused", () => {
    expectTypeOf(PeerErrorCode.SessionPaused).toEqualTypeOf<"session_paused">();
  });
});

// ─── SessionSignal ────────────────────────────────────────────────────────────

describe("SessionSignal", () => {
  test("type is string", () => {
    expectTypeOf<SessionSignal["type"]>().toEqualTypeOf<string>();
  });

  test("message is optional string", () => {
    expectTypeOf<SessionSignal["message"]>().toEqualTypeOf<
      string | undefined
    >();
  });
});

// ─── NegotiationResult.subscribeSignals ───────────────────────────────────────

describe("NegotiationResult.subscribeSignals", () => {
  type Sub = NonNullable<NegotiationResult["subscribeSignals"]>;

  test("accepts a SessionSignal handler", () => {
    expectTypeOf<Parameters<Sub>[0]>().toEqualTypeOf<
      (signal: SessionSignal) => void
    >();
  });

  test("returns an unsubscribe function", () => {
    expectTypeOf<ReturnType<Sub>>().toEqualTypeOf<() => void>();
  });
});

// ─── @sideband/peer/server ────────────────────────────────────────────────────

describe("@sideband/peer/server", () => {
  test("listen accepts ListenOptions and returns Promise<PeerServer>", () => {
    expectTypeOf<typeof listen>().toMatchTypeOf<
      (options: ListenOptions) => Promise<PeerServer>
    >();
  });
});
