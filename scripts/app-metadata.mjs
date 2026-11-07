/**
 * Creator-owned page metadata, injected into the dev page's index.html.
 *
 * `index.html` is a PLATFORM file: a template upgrade replaces it, and every
 * creator's title, description and share image used to live there and be lost
 * on upgrade. They now live in `app.config.json` at the repo root, which the
 * upgrade never reads and never writes (it is not in the zone manifest).
 * `scripts/dev.mjs` writes them with this module; the production build
 * (`vincentt build`) applies the same keys itself, and also requires `url` to
 * be https (vincentt-xr/v2-template#119).
 *
 * The file is OPTIONAL. A project without one (a repo scaffolded before this
 * existed, or a creator who deleted it) builds exactly what index.html says.
 * Every key is optional too; an absent key leaves index.html's tag alone.
 *
 *   {
 *     "title": "Magnetic Hands",                       // <title>, og:title, twitter:title
 *     "description": "Push the field with your hands", // meta description, og:/twitter:description
 *     "url": "https://magnetic-hands.vincentt.app",    // og:url, and the base for a relative image
 *     "image": "/images/share.jpg",                    // og:image, twitter:image (root-relative = public/)
 *     "imageAlt": "A hand bending a field of lines",   // og:image:alt, twitter:image:alt
 *     "imageWidth": 1200, "imageHeight": 630,          // og:image:width/height (optional)
 *     "imageType": "image/jpeg"                        // og:image:type (optional)
 *   }
 *
 * A root-relative image is made absolute against `url` when both are set,
 * because crawlers do not resolve relative `og:image` values. When `image` is
 * overridden without its dimensions, the default image's width/height/type
 * tags are REMOVED rather than left describing the wrong file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const APP_CONFIG = "app.config.json";

const STRING_KEYS = ["title", "description", "url", "image", "imageAlt", "imageType"];
const NUMBER_KEYS = ["imageWidth", "imageHeight"];
const KNOWN = new Set([...STRING_KEYS, ...NUMBER_KEYS]);

/** Validates a parsed config. Returns the problems; empty means it is usable. */
export function validateAppConfig(config) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return [`${APP_CONFIG} must be a JSON object`];
  }
  const problems = [];
  for (const key of Object.keys(config)) {
    if (!KNOWN.has(key)) problems.push(`unknown key "${key}" (known: ${[...KNOWN].join(", ")})`);
  }
  for (const key of STRING_KEYS) {
    const v = config[key];
    if (v !== undefined && typeof v !== "string") problems.push(`"${key}" must be a string`);
  }
  for (const key of NUMBER_KEYS) {
    const v = config[key];
    if (v !== undefined && !(Number.isInteger(v) && v > 0)) {
      problems.push(`"${key}" must be a positive integer`);
    }
  }
  if (typeof config.url === "string" && !/^https?:\/\/[^\s"<>]+$/.test(config.url)) {
    problems.push(`"url" must be an absolute http(s) URL`);
  }
  if (typeof config.image === "string" && !/^(\/|https?:\/\/)/.test(config.image)) {
    problems.push(`"image" must start with "/" (a file under public/) or be an http(s) URL`);
  }
  for (const key of ["title", "description", "image", "imageAlt"]) {
    if (typeof config[key] === "string" && /[<>]/.test(config[key])) {
      problems.push(`"${key}" must not contain < or >`);
    }
  }
  return problems;
}

/**
 * Reads and validates `<root>/app.config.json`. A missing file is `{}`; a file
 * that does not parse or does not validate THROWS, because a build that
 * silently shipped the template's default title over a creator's typo would be
 * discovered on the share card, after publish.
 */
export function readAppConfig(root) {
  let text;
  try {
    text = readFileSync(join(root, APP_CONFIG), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${APP_CONFIG} is not valid JSON: ${err.message}`);
  }
  const problems = validateAppConfig(parsed);
  if (problems.length > 0) {
    throw new Error(`${APP_CONFIG} is invalid:\n  - ${problems.join("\n  - ")}`);
  }
  return parsed;
}

const escapeAttr = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Matches one `<meta property|name="…" content="…">` tag, any attribute order, any whitespace. */
const metaTag = (attr, key) =>
  new RegExp(
    `<meta\\s+(?:[^>]*?\\s)?${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`,
    "g",
  );

function setMeta(html, attr, key, content) {
  const tag = `<meta ${attr}="${key}" content="${escapeAttr(content)}" />`;
  const re = metaTag(attr, key);
  if (re.test(html)) {
    let first = true;
    return html.replace(re, () => {
      // A duplicate from a hand edit collapses to one tag.
      if (!first) return "";
      first = false;
      return tag;
    });
  }
  // Absent: add it before </head>, indented like the rest.
  return html.replace(/<\/head>/, `    ${tag}\n  </head>`);
}

function removeMeta(html, attr, key) {
  return html.replace(new RegExp(`\\s*${metaTag(attr, key).source}`, "g"), "");
}

/** Resolves a root-relative image against the configured URL, when both exist. */
export function resolveImage(image, url) {
  if (!image || !url) return image;
  if (/^https?:\/\//.test(image)) return image;
  try {
    return new URL(image, url).toString();
  } catch {
    return image;
  }
}

/** Pure: index.html text in, index.html text with the config applied out. */
export function applyAppMetadata(html, config = {}) {
  let out = html;
  const { title, description, url, imageAlt, imageWidth, imageHeight, imageType } = config;
  const image = resolveImage(config.image, url);

  if (title !== undefined) {
    out = out.replace(/<title>[^<]*<\/title>/, `<title>${escapeText(title)}</title>`);
    out = setMeta(out, "property", "og:title", title);
    out = setMeta(out, "name", "twitter:title", title);
  }
  if (description !== undefined) {
    out = setMeta(out, "name", "description", description);
    out = setMeta(out, "property", "og:description", description);
    out = setMeta(out, "name", "twitter:description", description);
  }
  if (url !== undefined) {
    out = setMeta(out, "property", "og:url", url);
  }
  if (image !== undefined) {
    out = setMeta(out, "property", "og:image", image);
    out = setMeta(out, "name", "twitter:image", image);
    // The default tags describe the default image. Replace them when the
    // creator says, drop them when they do not — the alt text included, which
    // would otherwise describe the template's picture under the creator's.
    for (const [key, value] of [
      ["og:image:type", imageType],
      ["og:image:width", imageWidth],
      ["og:image:height", imageHeight],
    ]) {
      out = value === undefined ? removeMeta(out, "property", key) : setMeta(out, "property", key, value);
    }
    if (imageAlt === undefined) {
      out = removeMeta(out, "property", "og:image:alt");
      out = removeMeta(out, "name", "twitter:image:alt");
    }
  } else {
    for (const [key, value] of [
      ["og:image:type", imageType],
      ["og:image:width", imageWidth],
      ["og:image:height", imageHeight],
    ]) {
      if (value !== undefined) out = setMeta(out, "property", key, value);
    }
  }
  if (imageAlt !== undefined) {
    out = setMeta(out, "property", "og:image:alt", imageAlt);
    out = setMeta(out, "name", "twitter:image:alt", imageAlt);
  }
  return out;
}
