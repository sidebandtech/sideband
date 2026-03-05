// SPDX-License-Identifier: Apache-2.0

import {
  type FrameId,
  type MessageFrame,
  type Subject,
  createErrorFrame,
  createMessageFrame,
  encodeFrame,
  ErrorCode,
} from "@sideband/protocol";
import {
  createRpcErrorResponse,
  createRpcSuccessResponse,
  decodeRpcEnvelope,
  encodeRpcEnvelope,
  isRpcNotification,
  isRpcRequest,
  RpcErrorCode,
} from "@sideband/rpc";
import type { Unsubscribe } from "../types.js";
import { HandlerRegistry } from "./dispatch.js";
import {
  type SubjectPolicy,
  defaultSubjectPolicy,
  getDefaultMode,
  validateSubject,
} from "./subject-policy.js";
import type {
  InboundMessage,
  MessageHandler,
  RouteOptions,
  RouterConfig,
  RpcContext,
  RpcErrorPayload,
  SessionLike,
} from "./types.js";

const DEFAULT_RPC_TIMEOUT_MS = 30000;

const defaultErrorMapper = (error: Error): RpcErrorPayload => ({
  code: 2000,
  message: error.message,
});

/**
 * Message router per ADR-011.
 * Handles registration, dispatch ordering, and RPC envelope processing.
 */
export class Router {
  private readonly registry = new HandlerRegistry();
  private readonly config: Required<RouterConfig>;
  private readonly subjectPolicy: SubjectPolicy;

  constructor(
    config: RouterConfig = {},
    subjectPolicy: SubjectPolicy = defaultSubjectPolicy,
  ) {
    this.config = {
      rpcTimeoutMs: config.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS,
      errorMapper: config.errorMapper ?? defaultErrorMapper,
    };
    this.subjectPolicy = subjectPolicy;
  }

  /**
   * Register handler for exact subject match.
   */
  route(
    subject: string,
    handler: MessageHandler,
    options?: RouteOptions,
  ): Unsubscribe {
    const validation = validateSubject(subject, this.subjectPolicy);
    if (!validation.valid) {
      throw new Error(
        `Invalid subject "${subject}": ${validation.errorMessage}`,
      );
    }
    const mode = options?.mode ?? getDefaultMode(validation.kind!);
    return this.registry.routeExact(subject, handler, mode);
  }

  /**
   * Register handler for subject prefix.
   */
  routePrefix(
    prefix: string,
    handler: MessageHandler,
    options?: RouteOptions,
  ): Unsubscribe {
    // Validate prefix by appending a dummy segment
    const validation = validateSubject(prefix + "test", this.subjectPolicy);
    if (!validation.valid) {
      throw new Error(`Invalid prefix "${prefix}": ${validation.errorMessage}`);
    }
    const mode = options?.mode ?? getDefaultMode(validation.kind!);
    return this.registry.routePrefix(prefix, handler, mode);
  }

  /**
   * Remove all handlers for a subject.
   */
  unroute(subject: string): void {
    this.registry.unroute(subject);
  }

  /**
   * Clear all handlers.
   */
  clear(): void {
    this.registry.clear();
  }

  /**
   * Dispatch a message frame to matching handlers.
   * Returns error frame bytes if dispatch fails (for sending back to peer).
   */
  async dispatch(
    frame: MessageFrame,
    session: SessionLike,
  ): Promise<Uint8Array | null> {
    const subject = frame.subject as string;

    // Validate subject
    const validation = validateSubject(subject, this.subjectPolicy);
    if (!validation.valid) {
      return encodeFrame(
        createErrorFrame(
          validation.errorCode!,
          validation.errorMessage!,
          undefined,
          { frameId: frame.frameId },
        ),
      );
    }

    const handlers = this.registry.getMatching(subject);

    // Create InboundMessage
    const msg = this.createInboundMessage(frame, session);

    // Handle RPC subjects
    if (validation.kind === "rpc") {
      return this.dispatchRpc(frame, session, handlers, msg);
    }

    // Handle event subjects (broadcast)
    if (validation.kind === "event") {
      return this.dispatchEvent(handlers, msg);
    }

    // Handle custom subjects
    return this.dispatchCustom(handlers, msg);
  }

  private async dispatchRpc(
    frame: MessageFrame,
    session: SessionLike,
    handlers: Array<{ handler: MessageHandler; mode: string }>,
    msg: InboundMessage,
  ): Promise<Uint8Array | null> {
    // Decode RPC envelope
    let envelope;
    try {
      envelope = decodeRpcEnvelope(frame.data);
    } catch {
      // Malformed envelope - emit ErrorFrame (code 1002)
      return encodeFrame(
        createErrorFrame(
          ErrorCode.InvalidFrame,
          "Malformed RPC envelope",
          undefined,
          { frameId: frame.frameId },
        ),
      );
    }

    // Must be a request
    if (!isRpcRequest(envelope)) {
      // Responses should be handled by correlation manager, not router
      return null;
    }

    // No handler - return UnsupportedMethod
    if (handlers.length === 0) {
      const errorEnvelope = createRpcErrorResponse(
        envelope.cid,
        RpcErrorCode.UnsupportedMethod,
        "Method not found",
      );
      const responseFrame = createMessageFrame(
        frame.subject,
        encodeRpcEnvelope(errorEnvelope),
      );
      await session.send(encodeFrame(responseFrame));
      return null;
    }

    // Add RPC context to message
    const rpcMsg = this.addRpcContext(msg, envelope, frame.subject, session);

    // Dispatch to first handler (exclusive mode for RPC)
    const firstHandler = handlers[0];
    if (!firstHandler) {
      return null; // Unreachable, but satisfies TypeScript
    }
    const handler = firstHandler.handler;
    let replied = false;

    // Wrap reply/error to track if handler replied
    const trackedRpcContext: RpcContext = {
      method: rpcMsg.rpc!.method,
      params: rpcMsg.rpc!.params,
      cid: rpcMsg.rpc!.cid,
      async reply(result?: unknown) {
        replied = true;
        await rpcMsg.rpc!.reply(result);
      },
      async error(code: number, message: string, data?: unknown) {
        replied = true;
        await rpcMsg.rpc!.error(code, message, data);
      },
    };

    const trackedMsg: InboundMessage = { ...rpcMsg, rpc: trackedRpcContext };

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error("Handler timeout")),
          this.config.rpcTimeoutMs,
        );
      });

      // Race handler against timeout
      await Promise.race([
        Promise.resolve(handler(trackedMsg)),
        timeoutPromise,
      ]);
    } catch (err) {
      if (!replied) {
        const error = err instanceof Error ? err : new Error(String(err));

        // Check if timeout
        if (error.message === "Handler timeout") {
          const errorEnvelope = createRpcErrorResponse(
            envelope.cid,
            RpcErrorCode.Timeout,
            "Handler timeout",
          );
          const responseFrame = createMessageFrame(
            frame.subject,
            encodeRpcEnvelope(errorEnvelope),
          );
          await session.send(encodeFrame(responseFrame));
        } else {
          // Map error using errorMapper
          const errorPayload = this.config.errorMapper(error, trackedMsg);
          const errorEnvelope = createRpcErrorResponse(
            envelope.cid,
            errorPayload.code,
            errorPayload.message,
            errorPayload.data,
          );
          const responseFrame = createMessageFrame(
            frame.subject,
            encodeRpcEnvelope(errorEnvelope),
          );
          await session.send(encodeFrame(responseFrame));
        }
      }
    }

    return null;
  }

  private async dispatchEvent(
    handlers: Array<{ handler: MessageHandler; mode: string }>,
    msg: InboundMessage,
  ): Promise<Uint8Array | null> {
    // Decode notification envelope (fire and forget)
    try {
      const envelope = decodeRpcEnvelope(msg.payload);
      if (!isRpcNotification(envelope)) {
        // Not a notification - log and drop per spec
        console.warn("Event subject received non-notification envelope");
        return null;
      }
    } catch {
      // Invalid envelope - log and drop per spec (no ErrorFrame for events)
      console.warn("Event subject received invalid envelope");
      return null;
    }

    // Broadcast to all handlers
    for (const { handler } of handlers) {
      try {
        await handler(msg);
      } catch (err) {
        // Log but continue to next handler per ADR-011
        console.warn("Event handler error:", err);
      }
    }

    return null;
  }

  private async dispatchCustom(
    handlers: Array<{ handler: MessageHandler; mode: string }>,
    msg: InboundMessage,
  ): Promise<Uint8Array | null> {
    // Broadcast to all handlers
    for (const { handler } of handlers) {
      try {
        await handler(msg);
      } catch (err) {
        console.warn("Custom handler error:", err);
      }
    }
    return null;
  }

  private createInboundMessage(
    frame: MessageFrame,
    session: SessionLike,
  ): InboundMessage {
    return {
      subject: frame.subject,
      payload: frame.data,
      peerId: session.peerId,
      session,
      frame: Object.freeze({ ...frame }),
      async send(subject: Subject, data: Uint8Array) {
        const newFrame = createMessageFrame(subject, data);
        await session.send(encodeFrame(newFrame));
      },
    };
  }

  private addRpcContext(
    msg: InboundMessage,
    envelope: { m: string; p?: unknown; cid: FrameId },
    responseSubject: Subject,
    session: SessionLike,
  ): InboundMessage {
    const rpcContext: RpcContext = {
      method: envelope.m,
      params: envelope.p,
      cid: envelope.cid,
      async reply(result?: unknown) {
        const responseEnvelope = createRpcSuccessResponse(envelope.cid, result);
        const responseFrame = createMessageFrame(
          responseSubject,
          encodeRpcEnvelope(responseEnvelope),
        );
        await session.send(encodeFrame(responseFrame));
      },
      async error(code: number, message: string, data?: unknown) {
        const errorEnvelope = createRpcErrorResponse(
          envelope.cid,
          code,
          message,
          data,
        );
        const responseFrame = createMessageFrame(
          responseSubject,
          encodeRpcEnvelope(errorEnvelope),
        );
        await session.send(encodeFrame(responseFrame));
      },
    };

    return { ...msg, rpc: rpcContext };
  }
}

/**
 * Create a router with configuration.
 */
export function createRouter(
  config?: RouterConfig,
  subjectPolicy?: SubjectPolicy,
): Router {
  return new Router(config, subjectPolicy);
}
