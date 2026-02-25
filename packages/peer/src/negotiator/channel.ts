// SPDX-License-Identifier: Apache-2.0

/**
 * Encrypted session channel wrapping a transport connection with SBRP encryption.
 *
 * Crypto operations (encrypt/decrypt/clear) are injected by the caller,
 * keeping this module agnostic to client vs. daemon role.
 */

import type { TransportConnection } from "@sideband/runtime";
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

/** Injected crypto operations for the encrypted channel. */
export interface ChannelCrypto {
  encrypt(plaintext: Uint8Array): EncryptedMessage;
  decrypt(message: EncryptedMessage): Uint8Array;
  /** Zeroize session keys. */
  clear(): void;
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
): TransportConnection {
  let closed = false;

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
      if (closed) return;
      closed = true;
      crypto.clear();
    },

    inbound: {
      async *[Symbol.asyncIterator]() {
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
            // Non-terminal control frames (rate_limited, session_paused, etc.) are skipped
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
      },
    },
  };
}
