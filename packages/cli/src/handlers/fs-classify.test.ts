// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { classifyFile } from "./fs-classify.js";

describe("classifyFile", () => {
  describe("semantic text (specific MIME types)", () => {
    it(".json → application/json", () => {
      expect(classifyFile("data.json")).toEqual({
        encoding: "utf8",
        mediaType: "application/json",
      });
    });

    it(".jsonc → application/json", () => {
      expect(classifyFile("tsconfig.jsonc")).toEqual({
        encoding: "utf8",
        mediaType: "application/json",
      });
    });

    it(".html → text/html", () => {
      expect(classifyFile("index.html")).toEqual({
        encoding: "utf8",
        mediaType: "text/html",
      });
    });

    it(".htm → text/html", () => {
      expect(classifyFile("page.htm")).toEqual({
        encoding: "utf8",
        mediaType: "text/html",
      });
    });

    it(".css → text/css", () => {
      expect(classifyFile("style.css")).toEqual({
        encoding: "utf8",
        mediaType: "text/css",
      });
    });

    it(".scss → text/css", () => {
      expect(classifyFile("style.scss")).toEqual({
        encoding: "utf8",
        mediaType: "text/css",
      });
    });

    it(".svg → image/svg+xml", () => {
      expect(classifyFile("icon.svg")).toEqual({
        encoding: "utf8",
        mediaType: "image/svg+xml",
      });
    });

    it(".xml → text/xml", () => {
      expect(classifyFile("config.xml")).toEqual({
        encoding: "utf8",
        mediaType: "text/xml",
      });
    });
  });

  describe("plain text/code extensions (text/plain)", () => {
    it(".ts → text/plain", () => {
      expect(classifyFile("index.ts")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it(".tsx → text/plain", () => {
      expect(classifyFile("App.tsx")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it(".js → text/plain", () => {
      expect(classifyFile("app.js")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it(".md → text/plain", () => {
      expect(classifyFile("README.md")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it(".yaml → text/plain", () => {
      expect(classifyFile("docker-compose.yaml")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it(".sh → text/plain", () => {
      expect(classifyFile("deploy.sh")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it(".rs → text/plain", () => {
      expect(classifyFile("main.rs")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it(".sql → text/plain", () => {
      expect(classifyFile("schema.sql")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });
  });

  describe("image extensions (base64)", () => {
    it(".png → image/png", () => {
      expect(classifyFile("logo.png")).toEqual({
        encoding: "base64",
        mediaType: "image/png",
      });
    });

    it(".jpg → image/jpeg", () => {
      expect(classifyFile("photo.jpg")).toEqual({
        encoding: "base64",
        mediaType: "image/jpeg",
      });
    });

    it(".jpeg → image/jpeg", () => {
      expect(classifyFile("photo.jpeg")).toEqual({
        encoding: "base64",
        mediaType: "image/jpeg",
      });
    });

    it(".gif → image/gif", () => {
      expect(classifyFile("anim.gif")).toEqual({
        encoding: "base64",
        mediaType: "image/gif",
      });
    });

    it(".webp → image/webp", () => {
      expect(classifyFile("img.webp")).toEqual({
        encoding: "base64",
        mediaType: "image/webp",
      });
    });

    it(".ico → image/x-icon", () => {
      expect(classifyFile("favicon.ico")).toEqual({
        encoding: "base64",
        mediaType: "image/x-icon",
      });
    });
  });

  describe("unknown extensions → binary fallback", () => {
    it(".unknown → base64, null mediaType", () => {
      expect(classifyFile("file.unknown")).toEqual({
        encoding: "base64",
        mediaType: null,
      });
    });

    it(".wasm → base64, null mediaType", () => {
      expect(classifyFile("module.wasm")).toEqual({
        encoding: "base64",
        mediaType: null,
      });
    });

    it(".exe → base64, null mediaType", () => {
      expect(classifyFile("app.exe")).toEqual({
        encoding: "base64",
        mediaType: null,
      });
    });
  });

  describe("extensionless files (TEXT_NAMES lookup)", () => {
    it('"Dockerfile" → utf8/text-plain', () => {
      expect(classifyFile("Dockerfile")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it('"Makefile" → utf8/text-plain', () => {
      expect(classifyFile("Makefile")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it('"LICENSE" → utf8/text-plain', () => {
      expect(classifyFile("LICENSE")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it('"Gemfile" → utf8/text-plain', () => {
      expect(classifyFile("Gemfile")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it('".env" → utf8/text-plain (extensionless dotfile)', () => {
      expect(classifyFile(".env")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it('".gitignore" → utf8/text-plain', () => {
      expect(classifyFile(".gitignore")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it('".eslintrc" → utf8/text-plain', () => {
      expect(classifyFile(".eslintrc")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it('".prettierrc" → utf8/text-plain', () => {
      expect(classifyFile(".prettierrc")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it('".npmrc" → utf8/text-plain', () => {
      expect(classifyFile(".npmrc")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it('"unknown-extensionless" → base64, null (not in TEXT_NAMES)', () => {
      expect(classifyFile("unknown-extensionless")).toEqual({
        encoding: "base64",
        mediaType: null,
      });
    });
  });

  describe("case insensitivity", () => {
    it('"FOO.TS" classified as .ts (uppercase extension)', () => {
      expect(classifyFile("FOO.TS")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it('"LOGO.PNG" classified as .png', () => {
      expect(classifyFile("LOGO.PNG")).toEqual({
        encoding: "base64",
        mediaType: "image/png",
      });
    });

    it('".ENV" → utf8/text-plain (case-insensitive TEXT_NAMES)', () => {
      expect(classifyFile(".ENV")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it('"dockerfile" (lowercase) → utf8/text-plain', () => {
      expect(classifyFile("dockerfile")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });

    it('"license" (lowercase) → utf8/text-plain', () => {
      expect(classifyFile("license")).toEqual({
        encoding: "utf8",
        mediaType: "text/plain",
      });
    });
  });
});
