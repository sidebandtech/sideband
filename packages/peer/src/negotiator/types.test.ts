// SPDX-License-Identifier: Apache-2.0

import type { Negotiator } from "@sideband/runtime";
import { asDaemonId } from "@sideband/secure-relay";
import { describe, expectTypeOf, test } from "bun:test";
import { sbrpClientNegotiator } from "./client.js";
import { sbrpDaemonNegotiator } from "./daemon.js";
import { createMemoryIdentityKeyStore } from "./identity-key-store.js";
import type { SbrpClientOptions, TrustPolicy } from "./types.js";

describe("sbrp negotiator type contracts", () => {
  test("factory return types remain Negotiator", () => {
    const daemonId = asDaemonId("type-test-daemon");

    const clientNegotiator = sbrpClientNegotiator({
      daemonId,
      sessionId: 1n,
      identityKeyStore: createMemoryIdentityKeyStore(),
      trustPolicy: "auto",
    });

    const daemonNegotiator = sbrpDaemonNegotiator({
      daemonId,
      identityKeyPair: {
        publicKey: new Uint8Array(32),
        privateKey: new Uint8Array(32),
      },
    });

    expectTypeOf(clientNegotiator).toEqualTypeOf<Negotiator>();
    expectTypeOf(daemonNegotiator).toEqualTypeOf<Negotiator>();
  });

  test("client options enforce prompt callback at compile time", () => {
    expectTypeOf<
      Parameters<typeof sbrpClientNegotiator>[0]
    >().toEqualTypeOf<SbrpClientOptions>();

    if (false) {
      const daemonId = asDaemonId("type-test-daemon");
      const identityKeyStore = createMemoryIdentityKeyStore();

      sbrpClientNegotiator({
        daemonId,
        sessionId: 1n,
        identityKeyStore,
        trustPolicy: "prompt",
        onFirstConnection: async () => true,
      });

      sbrpClientNegotiator({
        daemonId,
        sessionId: 1n,
        identityKeyStore,
        trustPolicy: "auto",
      });

      // @ts-expect-error default trustPolicy is "prompt", so callback is required
      sbrpClientNegotiator({
        daemonId,
        sessionId: 1n,
        identityKeyStore,
      });

      // @ts-expect-error explicit "prompt" also requires callback
      sbrpClientNegotiator({
        daemonId,
        sessionId: 1n,
        identityKeyStore,
        trustPolicy: "prompt",
      });
    }
  });

  test("client options inference edge cases remain guarded", () => {
    if (false) {
      const daemonId = asDaemonId("type-test-daemon");
      const identityKeyStore = createMemoryIdentityKeyStore();

      // Widened policies that may include "prompt" must still require callback.
      const trustPolicy: TrustPolicy = "auto";
      // @ts-expect-error TrustPolicy includes "prompt", callback is required.
      sbrpClientNegotiator({
        daemonId,
        sessionId: 1n,
        identityKeyStore,
        trustPolicy,
      });

      sbrpClientNegotiator({
        daemonId,
        sessionId: 1n,
        identityKeyStore,
        trustPolicy,
        onFirstConnection: async (info) => {
          expectTypeOf(info.fingerprint).toEqualTypeOf<string>();
          return true;
        },
        onIdentityMismatch: async (info) => {
          expectTypeOf(info.expectedFingerprint).toEqualTypeOf<string>();
          expectTypeOf(info.receivedFingerprint).toEqualTypeOf<string>();
          return true;
        },
      });

      const options = {
        daemonId,
        sessionId: 1n,
        identityKeyStore,
        trustPolicy: "auto",
      } satisfies SbrpClientOptions;
      sbrpClientNegotiator(options);
    }
  });
});
