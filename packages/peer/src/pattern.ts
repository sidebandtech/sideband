// SPDX-License-Identifier: Apache-2.0

/**
 * NATS-style event pattern validation and matching.
 *
 * Grammar (from ADR-013 §2 "NATS-Style Event Pattern Syntax"):
 *
 *   event_name = segment ("." segment)*
 *   segment    = token | "*" | ">"
 *   token      = 1*SAFE_CHAR
 *   SAFE_CHAR  = ALPHA | DIGIT | "-" | "_"
 *
 * Wildcards (patterns only; invalid in literal event names):
 *   *  — matches exactly one segment
 *   >  — matches one or more trailing segments; MUST be the final segment
 *
 * Additional constraints:
 *   - Max 255 UTF-8 bytes
 *   - Case-sensitive
 *   - No empty segments, no leading/trailing dots
 *   - `**` is explicitly forbidden
 */

import { PeerError, PeerErrorCode } from "./errors.js";

const MAX_PATTERN_BYTES = 255;
const SAFE_CHAR = /^[A-Za-z0-9\-_]+$/;
const encoder = new TextEncoder();

/**
 * Validate a literal event name (no wildcards allowed).
 * Returns `true` if valid.
 */
export function isValidEventName(name: string): boolean {
  return validate(name, false) === null;
}

/**
 * Validate a subscription pattern (wildcards `*` and `>` allowed).
 * Throws `PeerError{ code: "invalid_pattern" }` if invalid.
 */
export function validatePattern(pattern: string): void {
  const err = validate(pattern, true);
  if (err !== null) {
    throw new PeerError(PeerErrorCode.InvalidPattern, err);
  }
}

/**
 * Test whether `name` matches `pattern`.
 * Both must already be validated.
 */
export function matchPattern(pattern: string, name: string): boolean {
  const pSegs = pattern.split(".");
  const nSegs = name.split(".");

  for (let i = 0; i < pSegs.length; i++) {
    const p = pSegs[i]!;
    if (p === ">") {
      // `>` is always the last segment (enforced by validation); matches rest
      return i < nSegs.length;
    }
    if (i >= nSegs.length) return false;
    if (p !== "*" && p !== nSegs[i]) return false;
  }
  return pSegs.length === nSegs.length;
}

// Returns null if valid, or an error string if invalid.
function validate(s: string, allowWildcards: boolean): string | null {
  if (typeof s !== "string" || s.length === 0) {
    return "Pattern must be a non-empty string";
  }

  // `**` is forbidden regardless (common mistake from glob habits)
  if (s.includes("**")) {
    return 'Invalid pattern: "**" is not supported. Use ">" for multi-segment wildcard';
  }

  const bytes = encoder.encode(s);
  if (bytes.length > MAX_PATTERN_BYTES) {
    return `Pattern exceeds ${MAX_PATTERN_BYTES} UTF-8 bytes (got ${bytes.length})`;
  }

  const segments = s.split(".");
  if (segments.length === 0 || segments.some((seg) => seg.length === 0)) {
    return "Pattern must not have empty segments or leading/trailing dots";
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const isLast = i === segments.length - 1;

    if (seg === "*") {
      if (!allowWildcards)
        return 'Wildcards "*" are not allowed in event names';
      continue;
    }

    if (seg === ">") {
      if (!allowWildcards)
        return 'Wildcards ">" are not allowed in event names';
      if (!isLast) return '">" must be the final segment';
      continue;
    }

    if (!SAFE_CHAR.test(seg)) {
      return `Invalid segment "${seg}": only A-Z, a-z, 0-9, "-", "_" are allowed`;
    }
  }

  return null;
}
