// SPDX-License-Identifier: Apache-2.0

import type { IdentityKeyStore } from "@sideband/peer/sbrp";
import type { DaemonId } from "@sideband/secure-relay";

const STORE_NAME = "pins";

function openDB(dbName: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    // blocked is transient — the request proceeds once the other tab closes.
    req.onblocked = () => console.warn("IndexedDB open blocked by another tab");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Browser-persistent IdentityKeyStore backed by IndexedDB.
 *
 * TOFU pins survive page reloads. Use createMemoryIdentityKeyStore() in Node/tests.
 * Different `dbName` values produce fully isolated databases.
 *
 * Persistence is best-effort — browsers may evict IndexedDB in private mode,
 * under storage pressure, or on user action. Lost pins require re-pairing.
 */
export function createIndexedDBIdentityKeyStore(
  dbName = "sideband-identity-keys",
): IdentityKeyStore {
  // Lazy-cached open promise: deferred to first use (safe in Node if never called),
  // and cleared on versionchange/error so the next operation reconnects.
  let db$: Promise<IDBDatabase> | null = null;

  function getDB(): Promise<IDBDatabase> {
    return (db$ ??= openDB(dbName).then(
      (db) => {
        db.onversionchange = () => {
          db.close();
          db$ = null;
        };
        return db;
      },
      (err) => {
        db$ = null;
        throw err;
      },
    ));
  }

  return {
    async get(daemonId: DaemonId) {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const value = await idbRequest<Uint8Array | undefined>(
        tx.objectStore(STORE_NAME).get(daemonId),
      );
      return value ? value.slice() : null;
    },

    async set(daemonId: DaemonId, publicKey: Uint8Array) {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      await idbRequest(
        tx.objectStore(STORE_NAME).put(publicKey.slice(), daemonId),
      );
    },

    async delete(daemonId: DaemonId) {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      await idbRequest(tx.objectStore(STORE_NAME).delete(daemonId));
    },

    async list() {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const keys = await idbRequest(tx.objectStore(STORE_NAME).getAllKeys());
      return keys as DaemonId[];
    },
  };
}
