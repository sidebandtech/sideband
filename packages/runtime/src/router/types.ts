// SPDX-License-Identifier: Apache-2.0

import type {
  FrameId,
  MessageFrame,
  PeerId,
  Subject,
} from "@sideband/protocol";

/** Cleanup function returned by route registration */
export type Unsubscribe = () => void;

/** Session interface (minimal for router, full definition in session/types.ts) */
export interface SessionLike {
  peerId: PeerId;
  send(data: Uint8Array): Promise<void>;
}

/** RPC context for rpc/ subjects */
export interface RpcContext {
  readonly method: string;
  readonly params: unknown;
  readonly cid: FrameId;
  reply(result?: unknown): Promise<void>;
  error(code: number, message: string, data?: unknown): Promise<void>;
}

/** Inbound message passed to handlers */
export interface InboundMessage {
  readonly subject: Subject;
  readonly payload: Uint8Array;
  readonly peerId: PeerId;
  readonly session: SessionLike;
  readonly frame: Readonly<MessageFrame>;
  send(subject: Subject, data: Uint8Array): Promise<void>;
  readonly rpc?: RpcContext;
}

/** Message handler function */
export type MessageHandler = (msg: InboundMessage) => Promise<void> | void;

/** Route registration options */
export interface RouteOptions {
  mode?: "exclusive" | "broadcast";
}

/** RPC error payload */
export interface RpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

/** Router configuration */
export interface RouterConfig {
  rpcTimeoutMs?: number;
  errorMapper?: (error: Error, msg: InboundMessage) => RpcErrorPayload;
}
