// SPDX-License-Identifier: Apache-2.0

/** Generate a random 128-bit (16-byte) hex ID using WebCrypto (platform-agnostic). */
export function generateId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
