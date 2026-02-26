// SPDX-License-Identifier: Apache-2.0

/**
 * Encrypted session channel wrapping a transport connection with SBRP encryption.
 *
 * Crypto operations (encrypt/decrypt/zeroize) are injected by the caller,
 * keeping this module agnostic to client vs. daemon role.
 */

import type { SessionSignal, TransportConnection } from "@sideband/runtime";
import type { EncryptedMessage, SessionId } from "@sideband/secure-relay";
import {
  decodeControl,
  decodeData,
  decodeFrame,
  encodeData,
  FrameType,
  fromWireControlCode,
  isTerminalCode,
  SbrpError,
  SbrpErrorCode,
} from "@sideband/secure-relay";

/**
 * Creates a signal replayer for use in `NegotiationResult.subscribeSignals`.
 *
 * Buffers signals that arrive before the first subscription (e.g. during the
 * inner SBP handshake) and replays them in order when subscribeSignals is called.
 * Enforces the single-subscriber invariant required by NegotiationResult.
 */
export function createSignalReplayer(): {
  onSignal: (signal: SessionSignal) => void;
  subscribeSignals: (handler: (signal: SessionSignal) => void) => () => void;
} {
  let listener: ((signal: SessionSignal) => void) | undefined;
  const buffer: SessionSignal[] = [];
  return {
    onSignal(signal) {
      if (listener) {
        listener(signal);
      } else {
        buffer.push(signal);
      }
    },
    subscribeSignals(handler) {
      if (listener) {
        throw new Error("SBRP channel: signals already subscribed");
      }
      listener = handler;
      for (const s of buffer.splice(0)) handler(s);
      return () => {
        listener = undefined;
      };
    },
  };
}

/** Injected crypto operations for the encrypted channel. */
export interface ChannelCrypto {
  encrypt(plaintext: Uint8Array): EncryptedMessage;
  decrypt(message: EncryptedMessage): Uint8Array;
  /** Zeroize session keys. */
  zeroize(): void;
}

/** Options for the encrypted SBRP channel. */
export interface SbrpChannelOptions {
  /** Called for non-terminal control frames (e.g., session_paused, session_resumed). */
  onSignal?: (signal: SessionSignal) => void;
}

/**
 * Create an encrypted channel wrapping a transport connection.
 *
 * - `send(data)`: encrypt plaintext → SBRP Data frame → transport
 * - `inbound`: transport → decode SBRP frame → decrypt Data frames → yield plaintext
 * - `close()`: zeroize session keys (does NOT close the underlying transport)
 */
export function createSbrpChannel(
  conn: TransportConnection,
  sessionId: SessionId,
  crypto: ChannelCrypto,
  options?: SbrpChannelOptions,
): TransportConnection {
  let closed = false;

  // Single teardown path: mark closed + zeroize keys. Idempotent.
  // Called from close(), terminal control frames, and malformed frame paths
  // so new error paths cannot accidentally skip key zeroization.
  const teardown = (): void => {
    if (closed) return;
    closed = true;
    crypto.zeroize();
  };

  return {
    id: conn.id,
    endpoint: conn.endpoint,

    async send(data: Uint8Array): Promise<void> {
      if (closed) {
        throw new Error("Cannot send on closed SBRP channel");
      }
      const encrypted = crypto.encrypt(data);
      const frame = encodeData(sessionId, encrypted);
      await conn.send(frame);
    },

    async close(): Promise<void> {
      teardown();
    },

    inbound: {
      async *[Symbol.asyncIterator]() {
        // Consumer break (.return()) defers teardown to explicit close() so keys
        // stay live through the data phase — `finally` would premature-zeroize them.
        try {
          for await (const bytes of conn.inbound) {
            if (closed) return;

            const frame = decodeFrame(bytes);

            if (frame.type === FrameType.Data) {
              const message = decodeData(frame);
              yield crypto.decrypt(message);
            } else if (frame.type === FrameType.Control) {
              const control = decodeControl(frame);
              if (isTerminalCode(control.code)) {
                const errorCode = fromWireControlCode(control.code);
                throw new SbrpError(
                  errorCode,
                  control.message || `Terminal control: ${errorCode}`,
                );
              }
              // Surface non-terminal control frames (session_paused, session_resumed, etc.).
              // Catch consumer throws so a buggy signal handler cannot tear down the channel.
              try {
                options?.onSignal?.({
                  type: fromWireControlCode(control.code),
                  message: control.message,
                });
              } catch {
                // Signal delivery is best-effort; channel stability takes priority.
              }
            } else if (
              frame.type === FrameType.Ping ||
              frame.type === FrameType.Pong
            ) {
              // Keepalive frames handled at transport level, skip
            } else {
              throw new SbrpError(
                SbrpErrorCode.MalformedFrame,
                `Unexpected frame type 0x${frame.type.toString(16).padStart(2, "0")} on encrypted channel`,
              );
            }
          }
          teardown(); // transport closed gracefully
        } catch (err) {
          teardown();
          throw err;
        }
      },
    },
  };
}
