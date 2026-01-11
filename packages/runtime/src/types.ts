// SPDX-License-Identifier: Apache-2.0

/** Session states per ADR-009 */
export type SessionState =
  | "idle"
  | "connecting"
  | "negotiating"
  | "active"
  | "retry-wait";

/** Verified identity from negotiator (e.g., Ed25519 fingerprint for SBRP TOFU) */
export interface VerifiedIdentity {
  type: "ed25519";
  fingerprint: string;
}

/** Function to unsubscribe from a handler or event */
export type Unsubscribe = () => void;
