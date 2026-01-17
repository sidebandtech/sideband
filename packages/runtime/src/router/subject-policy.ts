// SPDX-License-Identifier: Apache-2.0

/**
 * Subject validation and classification policy.
 *
 * Per ADR-006: `rpc`, `event`, `stream` are exact-match channels.
 * Only `app/` uses prefix semantics for custom sub-paths.
 */

export type SubjectKind = "rpc" | "event" | "custom" | "reserved";

export interface SubjectPolicy {
  /** Exact-match channel subjects (e.g., "rpc", "event") */
  allowedChannels: string[];
  /** Channels that are reserved/rejected (e.g., "stream") */
  reservedChannels: string[];
  /** Allowed prefixes for custom subjects (e.g., "app/") */
  allowedPrefixes: string[];
  /** Custom classifier for dispatch semantics */
  classify?(subject: string): SubjectKind;
}

export const defaultSubjectPolicy: SubjectPolicy = {
  allowedChannels: ["rpc", "event"],
  reservedChannels: ["stream"],
  allowedPrefixes: ["app/"],
};

export interface SubjectValidationResult {
  valid: boolean;
  kind?: SubjectKind;
  errorCode?: number;
  errorMessage?: string;
}

/**
 * Validate a subject against the policy.
 *
 * @param subject The subject string to validate
 * @param policy The subject policy to apply
 * @returns Validation result with kind or error details
 */
export function validateSubject(
  subject: string,
  policy: SubjectPolicy = defaultSubjectPolicy,
): SubjectValidationResult {
  // Check reserved channels first (highest priority, exact match)
  if (policy.reservedChannels.includes(subject)) {
    return {
      valid: false,
      errorCode: 1003, // UnsupportedFeature
      errorMessage: `Unsupported feature: ${subject}`,
    };
  }

  // Check exact-match channels
  if (policy.allowedChannels.includes(subject)) {
    const kind = policy.classify ? policy.classify(subject) : classify(subject);
    return { valid: true, kind };
  }

  // Check allowed prefixes
  const matchedPrefix = policy.allowedPrefixes.find((p) =>
    subject.startsWith(p),
  );
  if (matchedPrefix) {
    const kind = policy.classify ? policy.classify(subject) : classify(subject);
    return { valid: true, kind };
  }

  return {
    valid: false,
    errorCode: 1002, // InvalidFrame
    errorMessage: "Invalid subject namespace",
  };
}

function classify(subject: string): SubjectKind {
  switch (subject) {
    case "rpc":
      return "rpc";
    case "event":
      return "event";
    case "stream":
      return "reserved";
    default:
      return "custom";
  }
}

/**
 * Get the default dispatch mode for a subject kind.
 */
export function getDefaultMode(kind: SubjectKind): "exclusive" | "broadcast" {
  return kind === "rpc" ? "exclusive" : "broadcast";
}
