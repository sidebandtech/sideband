// SPDX-License-Identifier: Apache-2.0

/**
 * RPC-layer error codes (1100–1199 range).
 *
 * Each layer owns a non-overlapping code range; see error-codes.md.
 */
export enum RpcErrorCode {
  /** Envelope structure or encoding error */
  InvalidEnvelope = 1100,
  /** Method not recognized by handler */
  UnsupportedMethod = 1101,
  /** Response cid does not match any pending request */
  CorrelationMismatch = 1102,
  /** Request timed out waiting for response */
  Timeout = 1103,
  /** Envelope type incompatible with subject prefix */
  EnvelopeMismatch = 1104,
}
