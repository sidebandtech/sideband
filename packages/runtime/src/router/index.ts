// SPDX-License-Identifier: Apache-2.0

export type {
  InboundMessage,
  MessageHandler,
  RouteOptions,
  RouterConfig,
  RpcContext,
  RpcErrorPayload,
  SessionLike,
  Unsubscribe,
} from "./types.js";

export { HandlerRegistry } from "./dispatch.js";
export type { HandlerEntry } from "./dispatch.js";

export { createRouter, Router } from "./router.js";

export {
  defaultSubjectPolicy,
  getDefaultMode,
  validateSubject,
} from "./subject-policy.js";
export type {
  SubjectKind,
  SubjectPolicy,
  SubjectValidationResult,
} from "./subject-policy.js";
