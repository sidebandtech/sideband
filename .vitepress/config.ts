import { defineConfig } from "vitepress";

export default defineConfig({
  srcDir: "docs",

  title: "Sideband",
  description:
    "Secure communication stack for TypeScript — protocol, runtime, RPC, transports, and end-to-end encrypted relays.",

  lastUpdated: true,
  cleanUrls: true,

  sitemap: {
    hostname: "https://sideband.tech",
  },

  head: [
    ["meta", { name: "theme-color", content: "#5f67ee" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Sideband" }],
  ],

  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide/" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [{ text: "Getting Started", link: "/guide/" }],
      },
      {
        text: "Specs",
        items: [
          {
            text: "Secure Relay Protocol",
            link: "/specs/secure-relay-protocol",
          },
          {
            text: "SBRP State Machine",
            link: "/specs/secure-relay-protocol-state-machine",
          },
          {
            text: "SBRP Compliance",
            link: "/specs/secure-relay-protocol-compliance",
          },
        ],
      },
    ],

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
});
