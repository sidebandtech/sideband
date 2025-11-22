// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Branded types for compile-time safety without runtime overhead.
 */

type Brand<T, B> = T & { readonly __brand: B };

/**
 * Unique identifier for a peer.
 */
export type PeerId = Brand<string, "PeerId">;

/**
 * Unique identifier for a connection between peers.
 */
export type ConnectionId = Brand<string, "ConnectionId">;

/**
 * Unique identifier for a frame instance on the wire.
 * In v1, this ID is used for request/response correlation and ACK linkage.
 * Reserved CorrelationId for v2 multi-hop tracing semantics.
 */
export type FrameId = Brand<string, "FrameId">;

/**
 * Unique identifier for correlating request/response pairs (reserved for v2).
 * In v1, frameId serves this purpose.
 */
export type CorrelationId = Brand<string, "CorrelationId">;

/**
 * Unique identifier for a logical stream within a connection.
 */
export type StreamId = Brand<string, "StreamId">;

/**
 * Helper to create branded types at runtime.
 */
export function asPeerId(value: string): PeerId {
  return value as PeerId;
}

export function asConnectionId(value: string): ConnectionId {
  return value as ConnectionId;
}

export function asFrameId(value: string): FrameId {
  return value as FrameId;
}

export function asCorrelationId(value: string): CorrelationId {
  return value as CorrelationId;
}

export function asStreamId(value: string): StreamId {
  return value as StreamId;
}
