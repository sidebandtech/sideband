// SPDX-License-Identifier: Apache-2.0

import type { DaemonId } from "@sideband/secure-relay";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { createIndexedDBIdentityKeyStore } from "./identity-key-store.js";

const D1 = "d_one" as DaemonId;
const D2 = "d_two" as DaemonId;
const KEY1 = new Uint8Array([1, 2, 3, 4]);
const KEY2 = new Uint8Array([5, 6, 7, 8]);

// Each test gets a fresh IndexedDB environment.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  // Nothing to clean up — IDBFactory is garbage-collected.
});

describe("createIndexedDBIdentityKeyStore", () => {
  it("set/get round-trip", async () => {
    const store = createIndexedDBIdentityKeyStore();
    await store.set(D1, KEY1);
    const result = await store.get(D1);
    expect(result).toEqual(KEY1);
  });

  it("get returns null for unknown key", async () => {
    const store = createIndexedDBIdentityKeyStore();
    expect(await store.get(D1)).toBeNull();
  });

  it("delete removes entry", async () => {
    const store = createIndexedDBIdentityKeyStore();
    await store.set(D1, KEY1);
    await store.delete(D1);
    expect(await store.get(D1)).toBeNull();
  });

  it("list returns all stored daemon IDs", async () => {
    const store = createIndexedDBIdentityKeyStore();
    await store.set(D1, KEY1);
    await store.set(D2, KEY2);
    const ids = await store.list();
    expect(ids.sort()).toEqual([D1, D2].sort());
  });

  it("defensive copy — mutating returned value does not affect store", async () => {
    const store = createIndexedDBIdentityKeyStore();
    await store.set(D1, KEY1);
    const copy = await store.get(D1);
    copy![0] = 0xff;
    expect(await store.get(D1)).toEqual(KEY1);
  });

  it("overwrite semantics — get returns the latest value", async () => {
    const store = createIndexedDBIdentityKeyStore();
    await store.set(D1, KEY1);
    await store.set(D1, KEY2);
    expect(await store.get(D1)).toEqual(KEY2);
  });

  it("persists across store instances", async () => {
    const store1 = createIndexedDBIdentityKeyStore("persist");
    await store1.set(D1, KEY1);

    const store2 = createIndexedDBIdentityKeyStore("persist");
    expect(await store2.get(D1)).toEqual(KEY1);
  });

  it("dbName isolation — two stores with different names do not share data", async () => {
    const storeA = createIndexedDBIdentityKeyStore("db-a");
    const storeB = createIndexedDBIdentityKeyStore("db-b");
    await storeA.set(D1, KEY1);
    expect(await storeB.get(D1)).toBeNull();
  });
});
