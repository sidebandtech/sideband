---
url: /protocols/sbrp/threat-model.md
---
# Threat Model

> **Authority**: Primary (Normative)\
> **Purpose**: Defines attacker model, trust boundaries, and security assumptions for SBRP.

## Attacker Model

SBRP considers three attacker types with progressively stronger capabilities:

1. **Network attacker**: Can observe, modify, delay, or drop traffic between any endpoints
2. **Compromised relay**: Has full control of the relay server, including routing and metadata
3. **Compromised control plane**: Can issue arbitrary tokens, forge user authorization

## Trust Boundaries

| Component       | Trust Level        | Compromise Impact                              |
| --------------- | ------------------ | ---------------------------------------------- |
| Relay auth      | Trusted            | Can deny service, can't decrypt                |
| Relay transport | Honest-but-curious | Sees encrypted blobs only                      |
| Client runtime  | Trusted            | Full compromise (inherent to web for browsers) |
| Daemon          | Trusted            | Full compromise                                |

## Threat Mitigations

| Threat                 | Attacker | Mitigation                        | Result                                |
| ---------------------- | -------- | --------------------------------- | ------------------------------------- |
| Read messages          | Relay    | ChaCha20-Poly1305                 | Cannot decrypt                        |
| MITM handshake         | Relay    | Ed25519 signatures + TOFU pinning | Cannot forge (after first connection) |
| Key substitution       | Relay    | TOFU identity pinning             | Detected on subsequent connections    |
| Replay messages        | Network  | Bitmap sequence window            | Rejected                              |
| Impersonate daemon     | Relay    | No private key access             | Cannot sign                           |
| Cross-daemon confusion | Relay    | daemonId in signature payload     | Rejected                              |
| Deny service           | Relay    | N/A                               | Accepted risk                         |

## Attack Resistance

| Attack               | Mitigation                                                                    |
| -------------------- | ----------------------------------------------------------------------------- |
| Relay reads messages | E2EE encryption                                                               |
| Relay MITM           | Ed25519 signatures on ephemeral keys                                          |
| Replay attack        | Sequence numbers, sliding window                                              |
| Reflection attack    | Directional keys                                                              |
| Key substitution     | Signature binds ephemeral to identity                                         |
| Session hijacking    | Token-based auth; relay acts on tokens, cannot verify user intent (see below) |

## Known Limitations

| Attack                         | Status                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Compromised relay auth         | Can deny service, can't decrypt or MITM                                                                          |
| Compromised client runtime     | Full compromise (inherent to web apps for browsers)                                                              |
| Traffic analysis               | Relay sees timing, size, frequency; may infer high-level usage patterns                                          |
| Daemon identity key compromise | Must rotate key, re-register                                                                                     |
| Relay user impersonation       | Relay cannot verify user actually requested the session; client is not cryptographically authenticated to daemon |

## Assumptions

* TLS between all WebSocket endpoints (browser-relay, daemon-relay)
* Control plane is trusted for initial key distribution (TOFU limitation)
* Daemon private keys are stored securely (file permissions `0600`)
* Clients implement durable TOFU key pinning (IndexedDB or equivalent)
* Replay window is implemented correctly (bitmap-based, at least 64 messages)
