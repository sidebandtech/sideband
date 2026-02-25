// SPDX-License-Identifier: Apache-2.0

import type { DaemonId } from "@sideband/secure-relay";
import type { IdentityKeyStore } from "./types.js";

/** In-memory identity key store for testing and development. */
export function createMemoryIdentityKeyStore(): IdentityKeyStore {
  const store = new Map<DaemonId, Uint8Array>();

  return {
    async get(daemonId) {
      const key = store.get(daemonId);
      return key ? key.slice() : null;
    },

    async set(daemonId, publicKey) {
      store.set(daemonId, publicKey.slice());
    },

    async delete(daemonId) {
      store.delete(daemonId);
    },

    async list() {
      return [...store.keys()];
    },
  };
}
