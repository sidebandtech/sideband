# Plan: `createIndexedDBIdentityKeyStore`

Browser-persistent `IdentityKeyStore` implementation for TOFU identity pins using IndexedDB.

## Scope

Single factory function in `@sideband/cloud` — implements the existing `IdentityKeyStore` interface from `@sideband/peer`.

## API

```ts
/** Browser-only. Use createMemoryIdentityKeyStore() in Node/test. */
function createIndexedDBIdentityKeyStore(dbName?: string): IdentityKeyStore;
```

- `dbName` defaults to `"sideband-identity-keys"` (different name = different DB = full isolation)
- Returns the standard `IdentityKeyStore` interface (get/set/delete/list)

## Schema

- DB version: 1
- Single object store: `"pins"` with out-of-line keys (`DaemonId` strings)
- Values: `Uint8Array` (consistent with interface and memory store)

## Implementation Details

- **Lazy open**: cache the `Promise<IDBDatabase>`, not the resolved DB — prevents concurrent open races
- **Defensive copy**: `.slice()` on both read and write (matches memory store semantics)
- **`onversionchange`**: `db.onversionchange = () => db.close()` — prevents multi-tab locking
- **No dependencies** beyond the IndexedDB global

## Tests

Using `fake-indexeddb` (already available in Bun test):

1. set/get round-trip
2. get returns `null` for unknown key
3. delete removes entry
4. list returns all stored daemon IDs
5. defensive copy (mutating returned key doesn't affect store)
6. overwrite semantics (set same daemonId twice, get returns latest)
7. dbName isolation (two stores with different names don't share data)
