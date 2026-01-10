import fs from "node:fs/promises";
import path from "node:path";
import { codeToHtml } from "shiki";
import type { Plugin } from "vite";
import { defineConfig } from "vitepress";
import llmstxt, {
  copyOrDownloadAsMarkdownButtons,
} from "vitepress-plugin-llms";

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

  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons);
    },
  },

  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "Protocols", link: "/protocols/" },
    ],

    sidebar: [
      { text: "Why Sideband?", link: "/why-sideband" },
      {
        text: "Guide",
        items: [{ text: "Getting Started", link: "/guide/" }],
      },
      {
        text: "Protocols",
        items: [
          { text: "Overview", link: "/protocols/" },
          { text: "SBP", link: "/protocols/sbp/" },
          { text: "SBRP", link: "/protocols/sbrp/" },
          { text: "RPC", link: "/protocols/rpc/" },
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
