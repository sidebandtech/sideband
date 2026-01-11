// SPDX-License-Identifier: Apache-2.0

/**
 * Subject validation and classification policy.
 */

export type SubjectKind = "rpc" | "event" | "custom" | "reserved";

export interface SubjectPolicy {
  allowedPrefixes: string[];
  reservedPrefixes: string[];
  classify?(subject: string): SubjectKind;
}

export const defaultSubjectPolicy: SubjectPolicy = {
  allowedPrefixes: ["rpc/", "event/", "stream/", "app/"],
  reservedPrefixes: ["stream/"],
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
  // Check reserved prefixes first (highest priority)
  for (const reserved of policy.reservedPrefixes) {
    if (subject.startsWith(reserved)) {
      return {
        valid: false,
        errorCode: 1003, // UnsupportedFeature
        errorMessage: `Unsupported feature: ${reserved}`,
      };
    }
  }

  // Check allowed prefixes
  let matchedPrefix: string | undefined;
  for (const allowed of policy.allowedPrefixes) {
    if (subject.startsWith(allowed)) {
      matchedPrefix = allowed;
      break;
    }
  }

  if (!matchedPrefix) {
    return {
      valid: false,
      errorCode: 1002, // InvalidFrame
      errorMessage: "Invalid subject namespace",
    };
  }

  // Classify the subject
  let kind: SubjectKind;
  if (policy.classify) {
    kind = policy.classify(subject);
  } else {
    kind = classifyByPrefix(matchedPrefix);
  }

  return { valid: true, kind };
}

function classifyByPrefix(prefix: string): SubjectKind {
  switch (prefix) {
    case "rpc/":
      return "rpc";
    case "event/":
      return "event";
    case "stream/":
      return "reserved";
    case "app/":
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
