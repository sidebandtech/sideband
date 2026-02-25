// SPDX-License-Identifier: Apache-2.0

/** Returns a promise that resolves to `"timeout"` after `ms`, with a cancel handle. */
export function cancellableTimeout(ms: number) {
  let id: ReturnType<typeof setTimeout>;
  return {
    promise: new Promise<"timeout">((resolve) => {
      id = setTimeout(() => resolve("timeout"), ms);
    }),
    cancel: () => clearTimeout(id),
  };
}
