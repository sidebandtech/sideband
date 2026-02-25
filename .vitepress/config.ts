import fs from "node:fs/promises";
import path from "node:path";
import { codeToHtml } from "shiki";
import type { Plugin } from "vite";
import { defineConfig } from "vitepress";
import llmstxt from "vitepress-plugin-llms";

async function highlightCode(code: string, lang = "ts") {
  return codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}

function shikiInlinePlugin(): Plugin {
  return {
    name: "vitepress-shiki-inline",
    enforce: "pre",
    async load(id) {
      if (!id.includes("?")) return;
      const [filepath, query] = id.split("?", 2);
      const params = new URLSearchParams(query);
      if (!params.has("shiki")) return;
      const lang =
        params.get("lang") || path.extname(filepath).slice(1) || "text";
      const code = await fs.readFile(filepath, "utf8");
      const html = await highlightCode(code, lang);
      return `export default ${JSON.stringify(html)};`;
    },
  };
}

export default defineConfig({
  srcDir: "docs",

  title: "Sideband",
  description:
    "Drop-in SDK for browser-to-daemon communication. Works behind NAT. E2EE by default.",

  lastUpdated: true,
  cleanUrls: true,

  sitemap: {
    hostname: "https://sideband.tech",
  },

  head: [
    ["meta", { name: "theme-color", content: "#5f67ee" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Sideband" }],
    [
      "meta",
      {
        property: "og:title",
        content: "Sideband — Browser-to-daemon communication SDK",
      },
    ],
    [
      "meta",
      {
        property: "og:description",
        content:
          "Drop-in SDK for browser-to-daemon communication. Works behind NAT. E2EE by default.",
      },
    ],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:site", content: "@sidebandtech" }],
  ],

  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "SDK", link: "/sdk/" },
      { text: "Protocols", link: "/protocols/" },
    ],

    sidebar: [
      { text: "Why Sideband?", link: "/why-sideband" },
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/" },
          { text: "Concepts", link: "/guide/concepts" },
          { text: "RPC", link: "/guide/rpc" },
          { text: "Events", link: "/guide/events" },
          { text: "Server", link: "/guide/server" },
          { text: "E2EE Relay", link: "/guide/e2ee" },
          { text: "Testing", link: "/guide/testing" },
          { text: "Self-Hosting", link: "/guide/self-hosting" },
        ],
      },
      {
        text: "SDK",
        items: [
          { text: "Overview", link: "/sdk/" },
          { text: "Peer", link: "/sdk/peer" },
        ],
      },
      {
        text: "Runtime",
        collapsed: true,
        items: [
          { text: "Overview", link: "/runtime/" },
          { text: "Session", link: "/runtime/session" },
          { text: "Router", link: "/runtime/router" },
        ],
      },
      {
        text: "Protocols",
        items: [
          { text: "Overview", link: "/protocols/" },
          { text: "SBP", link: "/protocols/sbp/" },
          { text: "SBRP", link: "/protocols/sbrp/" },
          { text: "SBDP", link: "/protocols/sbdp/" },
          { text: "RPC", link: "/protocols/rpc/" },
        ],
      },
      {
        text: "ADRs",
        collapsed: true,
        items: [
          { text: "Overview", link: "/adr/" },
          {
            text: "001: Versioning",
            link: "/adr/001-protocol-versioning-and-compatibility",
          },
          { text: "002: Naming Matrix", link: "/adr/002-naming-matrix" },
          {
            text: "003: Control Frame Invariants",
            link: "/adr/003-control-frame-invariants",
          },
          { text: "004: Binary FrameId", link: "/adr/004-binary-frameid" },
          { text: "005: Transport ABI", link: "/adr/005-transport-abi" },
          { text: "006: RPC Envelope", link: "/adr/006-rpc-envelope" },
          {
            text: "007: Immutable Frame Types",
            link: "/adr/007-immutable-frame-types",
          },
          {
            text: "008: Subject Validation",
            link: "/adr/008-subject-namespace-validation",
          },
          {
            text: "009: Peer Lifecycle",
            link: "/adr/009-runtime-peer-lifecycle",
          },
          {
            text: "010: RPC Correlation",
            link: "/adr/010-rpc-correlation-cid",
          },
          {
            text: "011: Message Routing",
            link: "/adr/011-runtime-message-routing",
          },
          {
            text: "012: WebSocket Transport",
            link: "/adr/012-websocket-transport-design",
          },
          {
            text: "013: Peer SDK Design",
            link: "/adr/013-peer-sdk-design",
          },
          {
            text: "014: Session Signals",
            link: "/adr/014-peer-session-signals",
          },
          {
            text: "015: P2P Direct Protocol",
            link: "/adr/015-p2p-direct-protocol",
          },
          {
            text: "016: Relay Server Design",
            link: "/adr/016-relay-server-design",
          },
        ],
      },
    ],

    outline: {
      level: [2, 3],
      label: "On this page",
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/sidebandtech/sideband/edit/main/docs/:path",
      text: "Edit this page",
    },

    lastUpdated: {
      text: "Last updated",
      formatOptions: {
        dateStyle: "short",
      },
    },

    externalLinkIcon: true,

    footer: {
      message:
        'Released under the <a href="https://github.com/sidebandtech/sideband/blob/main/LICENSE">Apache 2.0 License</a>.',
      copyright:
        'Copyright © 2025-present <a href="https://github.com/sidebandtech">Sideband</a>',
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/sidebandtech/sideband" },
      { icon: "x", link: "https://x.com/sidebandtech" },
      { icon: "bluesky", link: "https://bsky.app/profile/sideband.tech" },
      {
        icon: {
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
        },
        link: "https://github.com/sponsors/koistya",
        ariaLabel: "Sponsor",
      },
    ],
  },

  vite: {
    plugins: [shikiInlinePlugin(), llmstxt()],
  },
});
