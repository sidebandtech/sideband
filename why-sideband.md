---
url: /why-sideband.md
---
# Why Sideband?

Building browser ↔ local daemon communication is harder than it looks. What starts as "just WebSockets" becomes a months-long detour through reconnection state machines, NAT traversal, and TLS certificate management.

Sideband handles the hard parts so you can focus on your app.

**Sideband in one sentence:**

> Browser ↔ local daemon communication — without WebSocket code.

## The Problem

You have a local daemon (AI agent, dev tool, background service) and need a browser UI. Sounds simple:

```
Browser → WebSocket → localhost:3000 → Daemon
```

Then users arrive.

* First, reconnect bugs you cannot reproduce
* Then NATs and corporate firewalls
* Then HTTPS + localhost certificate hacks
* Then security reviews flag DNS rebinding
* Then support tickets say "it just hangs"

Each issue is solvable. Together, they turn networking into your product.

## Why This Keeps Happening

Browser ↔ daemon networking combines every hard thing at once: TCP state across sleep/wake, user networks you do not control, and security constraints around localhost. By the time it works for real users, you have rebuilt a small transport stack.

## Common Alternatives (and Their Limits)

### DIY WebSockets

* Reconnect logic is a state machine, not a retry loop
* Mixed-content and CORS lead to self-signed cert management
* Every release risks regression in edge cases

**Why Sideband wins:** Delete your WebSocket code. Reconnects, multiplexing, and correlation are handled.

### ngrok / Cloudflare Quick Tunnels

* ngrok injects an interstitial page that breaks API clients
* Cloudflare Quick Tunnels have no SSE support and aggressive phishing detection
* TLS terminates at their edge, so they can inspect traffic

**Why Sideband wins:** End-to-end encryption by default. No interstitials, no PKI ceremony.

### Tailscale / Mesh VPNs

* Requires VPN client install for every user
* Funnel needs account setup, ACL config, and port restrictions (443/8443/10000)
* Bundling `tsnet` bloats binary size and memory

**Why Sideband wins:** Browser-to-daemon access without VPN clients or admin console configuration.

### WebRTC DataChannels

* You still need a signaling channel (usually WebSockets)
* Hole-punching fails on symmetric NATs; TURN becomes mandatory
* Mobile carriers aggressively timeout UDP mappings

**Why Sideband wins:** Predictable relay-based sessions without signaling servers or TURN.

### Firebase / Supabase Realtime

* Broadcast is at-most-once (lossy); Postgres Changes hammers WAL
* Fan-out billing: 1 message to 100 subscribers = 101 billable messages
* Not designed for local daemon patterns

**Why Sideband wins:** Local-first RPC without cloud gravity or write amplification.

## What Sideband Does

Sideband replaces your browser ↔ daemon networking layer.

You do not manage:

* WebSocket lifecycles and reconnection state
* TLS certificates for localhost
* NAT traversal or port forwarding
* Multi-client coordination
* Request/response correlation

You get a single abstraction that works across networks and devices.

| Feature                | Benefit                                                |
| ---------------------- | ------------------------------------------------------ |
| E2EE by default        | Relay cannot decrypt your payloads                     |
| NAT traversal          | Works behind firewalls without port forwarding         |
| Automatic reconnection | Handles network changes, sleep/wake, flaky connections |
| Multiplexed streams    | Multiple concurrent requests over one connection       |
| Typed RPC              | Request/response correlation with TypeScript types     |

## How It Works

Sideband is a layered stack ([protocols](/protocols/)) with two session modes:

* **SBRP (relay-based)** — available today; secure sessions with end-to-end encryption
* **SBDP (direct/P2P)** — specified and planned for when peers can connect directly

```
┌─────────┐         ┌─────────┐         ┌─────────┐
│ Browser │◄─TLS───►│  Relay  │◄─TLS───►│ Daemon  │
└─────────┘         └─────────┘         └─────────┘
     │                   │                   │
     └────────── E2EE encrypted ─────────────┘
```

The relay validates tokens, routes connections, and sees metadata (timing/size), but cannot decrypt payloads. Endpoints authenticate daemons via Ed25519 signatures and establish session keys with X25519 + ChaCha20-Poly1305 (TOFU pinning on first connection).

## When Teams Switch to Sideband

* Localhost-only is blocking growth or demos
* Users want remote access from another device
* Reconnect bugs keep resurfacing
* Security reviews flag local endpoints
* You are tired of debugging networking instead of your product

If any of these sound familiar, you are past the point where DIY is cheap.

## When Sideband Is Not a Fit

* Cloud-native SaaS (you already have backend infra)
* Apps without a browser component
* Compliance-first environments (early-stage)

## Get Started

See the [Getting Started](/guide/) guide to add Sideband to your project.
