// @vitest-environment node
// #119 — creator metadata from app.config.json lands in the emitted HTML, and
// index.html (a platform file) is never the place it has to be edited.

import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyAppMetadata,
  readAppConfig,
  resolveImage,
  validateAppConfig,
} from "./app-metadata.mjs";

const TEMPLATE_HTML = readFileSync(join(process.cwd(), "index.html"), "utf8");

const meta = (html, attr, key) => {
  const m = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`).exec(html);
  return m ? m[1] : undefined;
};
const count = (html, attr, key) =>
  (html.match(new RegExp(`<meta\\s+${attr}="${key}"`, "g")) ?? []).length;

describe("applyAppMetadata", () => {
  it("leaves index.html byte-identical when there is no config", () => {
    expect(applyAppMetadata(TEMPLATE_HTML, {})).toBe(TEMPLATE_HTML);
    expect(applyAppMetadata(TEMPLATE_HTML)).toBe(TEMPLATE_HTML);
  });

  it("writes title, description, url and image into every tag that carries them", () => {
    const out = applyAppMetadata(TEMPLATE_HTML, {
      title: "Magnetic Hands",
      description: "Push the field with your hands",
      url: "https://magnetic-hands.vincentt.app",
      image: "/images/share.jpg",
      imageAlt: "A hand bending a field of lines",
    });
    expect(out).toContain("<title>Magnetic Hands</title>");
    expect(meta(out, "property", "og:title")).toBe("Magnetic Hands");
    expect(meta(out, "name", "twitter:title")).toBe("Magnetic Hands");
    expect(meta(out, "name", "description")).toBe("Push the field with your hands");
    expect(meta(out, "property", "og:description")).toBe("Push the field with your hands");
    expect(meta(out, "name", "twitter:description")).toBe("Push the field with your hands");
    expect(meta(out, "property", "og:url")).toBe("https://magnetic-hands.vincentt.app");
    // Root-relative image is made absolute against the url.
    expect(meta(out, "property", "og:image")).toBe("https://magnetic-hands.vincentt.app/images/share.jpg");
    expect(meta(out, "name", "twitter:image")).toBe("https://magnetic-hands.vincentt.app/images/share.jpg");
    expect(meta(out, "property", "og:image:alt")).toBe("A hand bending a field of lines");
    expect(meta(out, "name", "twitter:image:alt")).toBe("A hand bending a field of lines");
    // The default image's dimensions no longer describe this image.
    expect(count(out, "property", "og:image:type")).toBe(0);
    expect(count(out, "property", "og:image:width")).toBe(0);
    expect(count(out, "property", "og:image:height")).toBe(0);
    // Nothing duplicated, nothing of the template's default left behind.
    expect(count(out, "property", "og:title")).toBe(1);
    expect(out).not.toContain("XR App - Vincentt");
    expect(out).not.toContain("An AR experience built with Vincentt");
    expect(out).not.toContain("og-default.jpg");
    // Untouched platform parts survive.
    expect(out).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(meta(out, "property", "og:site_name")).toBe("Vincentt");
  });

  it("drops the default alt text when the image is overridden without one", () => {
    const out = applyAppMetadata(TEMPLATE_HTML, { image: "/share.png" });
    expect(count(out, "property", "og:image:alt")).toBe(0);
    expect(count(out, "name", "twitter:image:alt")).toBe(0);
    expect(out).not.toContain("Augmented Reality App builder");
  });

  it("refuses an image that is neither root-relative nor absolute", () => {
    expect(validateAppConfig({ image: "images/share.jpg" })).toContainEqual(
      expect.stringContaining('"image" must start with "/"'),
    );
    expect(validateAppConfig({ image: "/images/share.jpg" })).toEqual([]);
    expect(validateAppConfig({ image: "https://cdn.example.com/s.png" })).toEqual([]);
  });

  it("keeps the default image tags when only the title changes", () => {
    const out = applyAppMetadata(TEMPLATE_HTML, { title: "Only a title" });
    expect(meta(out, "property", "og:image")).toBe("/images/og-default.jpg");
    expect(meta(out, "property", "og:image:width")).toBe("1200");
    expect(meta(out, "name", "description")).toBe("An AR experience built with Vincentt");
  });

  it("writes image dimensions when given, and keeps an absolute image as-is", () => {
    const out = applyAppMetadata(TEMPLATE_HTML, {
      url: "https://x.vincentt.app",
      image: "https://cdn.example.com/share.png",
      imageWidth: 800,
      imageHeight: 418,
      imageType: "image/png",
    });
    expect(meta(out, "property", "og:image")).toBe("https://cdn.example.com/share.png");
    expect(meta(out, "property", "og:image:width")).toBe("800");
    expect(meta(out, "property", "og:image:height")).toBe("418");
    expect(meta(out, "property", "og:image:type")).toBe("image/png");
  });

  it("escapes attribute and text content", () => {
    const out = applyAppMetadata(TEMPLATE_HTML, { title: 'Say "hi" & bye' });
    expect(out).toContain("<title>Say \"hi\" &amp; bye</title>");
    expect(out).toContain('content="Say &quot;hi&quot; &amp; bye"');
  });

  it("adds a tag index.html does not carry (og:url) before </head>", () => {
    expect(count(TEMPLATE_HTML, "property", "og:url")).toBe(0);
    const out = applyAppMetadata(TEMPLATE_HTML, { url: "https://x.vincentt.app" });
    expect(count(out, "property", "og:url")).toBe(1);
    expect(out.indexOf('property="og:url"')).toBeLessThan(out.indexOf("</head>"));
  });
});


describe("resolveImage", () => {
  it("resolves root-relative against url, leaves absolute and missing alone", () => {
    expect(resolveImage("/a.jpg", "https://x.app/some/path")).toBe("https://x.app/a.jpg");
    expect(resolveImage("https://c/a.jpg", "https://x.app")).toBe("https://c/a.jpg");
    expect(resolveImage("/a.jpg", undefined)).toBe("/a.jpg");
    expect(resolveImage(undefined, "https://x.app")).toBeUndefined();
  });
});

describe("validateAppConfig / readAppConfig", () => {
  it("accepts the shipped default config", () => {
    expect(validateAppConfig(JSON.parse(readFileSync(join(process.cwd(), "app.config.json"), "utf8")))).toEqual([]);
  });

  it("refuses the wrong shapes, naming each", () => {
    expect(validateAppConfig([])).toEqual(["app.config.json must be a JSON object"]);
    const problems = validateAppConfig({
      title: 3,
      url: "magnetic-hands.vincentt.app",
      imageWidth: "1200",
      descripton: "typo",
      description: "<b>bold</b>",
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"title" must be a string'),
        expect.stringContaining('"url" must be an absolute http(s) URL'),
        expect.stringContaining('"imageWidth" must be a positive integer'),
        expect.stringContaining('unknown key "descripton"'),
        expect.stringContaining('"description" must not contain < or >'),
      ]),
    );
  });

  it("reads a missing file as {}, and throws on bad JSON or a bad shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "app-config-"));
    expect(readAppConfig(dir)).toEqual({});
    writeFileSync(join(dir, "app.config.json"), "{ not json");
    expect(() => readAppConfig(dir)).toThrow("not valid JSON");
    writeFileSync(join(dir, "app.config.json"), JSON.stringify({ title: 1 }));
    expect(() => readAppConfig(dir)).toThrow('"title" must be a string');
    writeFileSync(join(dir, "app.config.json"), JSON.stringify({ title: "Ok" }));
    expect(readAppConfig(dir)).toEqual({ title: "Ok" });
  });
});
