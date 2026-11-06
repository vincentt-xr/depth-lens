// 4C · QA-F13-G13 — the switcher is tree-shaken out of a PRODUCTION build.
//
// Blast radius: a static import ships the switcher, its icon dependency and the
// 12 preset CDN URLs into EVERY PUBLISHED CREATOR BUNDLE — the platform's own
// debug UI riding along inside a creator's shipped experience.
//
// ── WHY THIS FILE EXISTS IN v2-template AND NOT IN toolchain ──────────────────
//
// f3's own tree-shake case (`toolchain/.../qa_f3_share_treeshake.test.ts`) had to
// leave its NEGATIVE half `it.skip`-ped and explicitly UNVERIFIED, because the
// honest seam is a CONSUMING APP'S production build and v2-template was not in
// that worktree. It is in THIS one, so f13 closes that gap rather than inheriting
// the skip: the assertions below read the REAL emitted production assets.
//
// ── THE PREREQUISITE IS ASSERTED, NOT ASSUMED ─────────────────────────────────
//
// A bundle-grep case whose bundle does not exist reports ZERO MARKERS, which is
// indistinguishable from a perfect tree-shake. So the suite FAILS LOUDLY when
// `dist/` is missing rather than passing vacuously — the disarmed-check shape this
// catalog exists to refuse. Run `npm run build` first.
//
// ── TWO BUILD SHAPES, ONE PROPERTY ────────────────────────────────────────────
//
// A SELF-CONTAINED build (no `@vincentt-xr/runtime` pin) bundles the media-source
// module into a local code-split chunk, and the original cases read that chunk.
//
// A RUNTIME build (f23: the project pins `@vincentt-xr/runtime`) bundles nothing
// of the SDK. The page's import map points the media-source specifier at a file on
// the shared runtime origin, which statically imports runtime chunks; one of them
// holds the switcher body. The switcher markers are then nowhere in `dist/`, so a
// marker grep proves nothing on its own. The runtime cases reason OFFLINE over the
// pinned package's manifest (its static `imports` graph and `sizes`) instead: the
// media-source module and every chunk reachable ONLY through it (its exclusive
// static closure) must be neither preloaded nor statically reachable from what
// every visitor downloads up front. The runtime host is read from the import map,
// never hard-coded: CI builds against the prod origin, a local CLI may use staging.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const DIST = join(process.cwd(), "dist");
const ASSETS = join(DIST, "assets");
const INDEX_HTML = join(DIST, "index.html");
const RUNTIME_MANIFEST = join(process.cwd(), "node_modules/@vincentt-xr/runtime/manifest.json");
const SPEC = "@vincentt-xr/sdk/debug-ui/media-source";

/** Every emitted .js asset, main bundle and code-split chunks alike. */
function emittedScripts(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) emittedScripts(full, out);
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Every text file in dist (scripts, html, css, json, svg). Binaries carry no copy. */
function distTextFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) distTextFiles(full, out);
    else if (/\.(m?js|html|css|json|svg|txt|map)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Switcher-only markers that must not reach a creator's shipped experience.
 *
 * These are IMPLEMENTATION strings — the switcher's own rendered copy — and NOT
 * the export name `MediaSourceSwitcher`. That distinction is load-bearing: the
 * export name legitimately appears in the entry bundle as the property read off a
 * dynamic import's resolved module (`then(m => m.MediaSourceSwitcher)`), so a
 * case grepping for it fails against a CORRECT code-split build. Only the
 * component's own copy proves its BODY was inlined.
 */
const SWITCHER_MARKERS = ["No camera source", "Open Media Menu", "No image preview"];
/** An icon-dependency marker, reachable ONLY from the switcher. */
const ICON_MARKER = "lucide";
/** The preset asset basenames — the 12 CDN URLs the record names. */
const PRESET_ASSETS = [
  "person_fist_sign.jpg",
  "person_fullbody.jpg",
  "person_fullbody.mp4",
  "person_looking.mp4",
  "person_peace_sign.jpg",
  "person_portrait.jpg",
  "person_shaking_head.mp4",
  "person_side_portrait.jpg",
  "person_thumbUp.mp4",
  "three_people_smiling.jpg",
  "two_people_smiling.jpg",
  "two_people_smiling.mp4",
];

// ── Runtime-build helpers ─────────────────────────────────────────────────────

interface ImportMap {
  imports?: Record<string, string>;
  integrity?: Record<string, string>;
}

interface RuntimeManifest {
  version: string;
  specifiers: Record<string, string>;
  exports: Record<string, Record<string, string>>;
  imports: Record<string, string[]>;
  dynamicImports: Record<string, string[]>;
  sizes: Record<string, number>;
}

function readImportMap(html: string): ImportMap | null {
  const m = /<script\s+type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/.exec(html);
  return m ? (JSON.parse(m[1]) as ImportMap) : null;
}

const HTML = existsSync(INDEX_HTML) ? readFileSync(INDEX_HTML, "utf8") : "";
const IMPORT_MAP = readImportMap(HTML);
const MAPPED_SPEC_URL = IMPORT_MAP?.imports?.[SPEC];
/** A runtime build is one whose import map sends the media-source specifier off to a runtime URL. */
const IS_RUNTIME_BUILD = typeof MAPPED_SPEC_URL === "string" && /^https?:\/\//.test(MAPPED_SPEC_URL);

/**
 * Static `import`/`export ... from` specifiers in a minified ES module. A dynamic
 * `import("x")` never matches: the token after `import` must be whitespace, a
 * binding list or a quote, never a parenthesis.
 */
function staticSpecifiers(code: string): string[] {
  const out = new Set<string>();
  const re = /(?:^|[;}\s])(?:import|export)\s*(?:[\w$*{}\s,]*?from\s*)?["']([^"']+)["']/g;
  for (const m of code.matchAll(re)) out.add(m[1]);
  return [...out];
}

function dynamicSpecifiers(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.add(m[1]);
  return [...out];
}

function hrefs(html: string, rel: string): string[] {
  const out: string[] = [];
  for (const tag of html.matchAll(/<link\b[^>]*>/g)) {
    if (!new RegExp(`\\brel=["']${rel}["']`).test(tag[0])) continue;
    const h = /\bhref=["']([^"']+)["']/.exec(tag[0]);
    if (h) out.push(h[1]);
  }
  return out;
}

function staticClosure(manifest: RuntimeManifest, roots: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const key = stack.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const dep of manifest.imports[key] ?? []) stack.push(dep);
  }
  return seen;
}

interface RuntimeEvidence {
  manifest: RuntimeManifest;
  base: string;
  /** The media-source module: the specifier's file plus its per-export files. */
  moduleFiles: Set<string>;
  /** Runtime manifest keys named by `<link rel="modulepreload">`. */
  preloaded: Set<string>;
  /** Preload hrefs on the runtime origin that resolve to no manifest key. */
  unresolvedPreloads: string[];
  /** Local dist files the entry reaches by static import, the entry included. */
  entryLocalFiles: string[];
  /** Runtime manifest keys the entry's local static closure imports directly. */
  entryRuntimeImports: Set<string>;
  /** Bare or runtime specifiers the entry's local closure imports that resolve to no manifest key. */
  unresolvedEntryImports: string[];
  /** Everything an ordinary visitor downloads up front: static closure of entry imports and preloads. */
  shared: Set<string>;
  /** The module's own static closure. */
  moduleClosure: Set<string>;
  /** Members of the module's closure that nothing else up front reaches. */
  exclusive: Set<string>;
  /**
   * Members of the module's closure the entry's static imports do not reach,
   * preloads ignored. The preload case checks against this set: measured against
   * `shared`, a preloaded body chunk would count itself as shared and hide.
   */
  exclusiveOfEntry: Set<string>;
}

function entryScriptPath(html: string): string {
  const m = /<script\b[^>]*type=["']module["'][^>]*\bsrc=["']([^"']+)["']/.exec(html);
  expect(m, "index.html has no <script type=module src> entry").not.toBeNull();
  return join(DIST, m![1].replace(/^\//, ""));
}

function loadRuntimeEvidence(html: string = HTML): RuntimeEvidence {
  expect(
    existsSync(RUNTIME_MANIFEST),
    `the build maps ${SPEC} to the shared runtime but ${RUNTIME_MANIFEST} is missing; ` +
      "without it the runtime graph cannot be read offline",
  ).toBe(true);
  const manifest = JSON.parse(readFileSync(RUNTIME_MANIFEST, "utf8")) as RuntimeManifest;
  const importMap = readImportMap(html) ?? {};
  const mapped = importMap.imports?.[SPEC] ?? "";
  const specFile = manifest.specifiers[SPEC];
  expect(specFile, `the runtime manifest does not map ${SPEC}`).toBeTypeOf("string");
  expect(mapped.endsWith(`/${specFile}`), `${SPEC} maps to ${mapped}, not to ${specFile}`).toBe(true);
  const base = mapped.slice(0, mapped.length - specFile.length);
  expect(
    base.endsWith(`/v/${manifest.version}/`),
    `the import map's runtime base ${base} is not the pinned runtime ${manifest.version}`,
  ).toBe(true);

  const toKey = (url: string): string | null => {
    if (!url.startsWith(base)) return null;
    const key = url.slice(base.length);
    return key in manifest.sizes ? key : null;
  };
  const resolveSpecifier = (spec: string): string | null => {
    const url = importMap.imports?.[spec] ?? spec;
    return toKey(url);
  };

  const moduleFiles = new Set<string>([specFile, ...Object.values(manifest.exports[SPEC] ?? {})]);

  const preloaded = new Set<string>();
  const unresolvedPreloads: string[] = [];
  for (const href of hrefs(html, "modulepreload")) {
    if (!/^https?:\/\//.test(href)) continue;
    const key = toKey(href);
    if (key) preloaded.add(key);
    else unresolvedPreloads.push(href);
  }

  const entryLocalFiles: string[] = [];
  const entryRuntimeImports = new Set<string>();
  const unresolvedEntryImports: string[] = [];
  const stack = [entryScriptPath(html)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (entryLocalFiles.includes(file)) continue;
    entryLocalFiles.push(file);
    for (const spec of staticSpecifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".") || spec.startsWith("/")) {
        const local = spec.startsWith("/") ? join(DIST, spec) : resolve(dirname(file), spec);
        if (existsSync(local)) stack.push(local);
        else unresolvedEntryImports.push(`${relative(DIST, file)} -> ${spec}`);
        continue;
      }
      const key = resolveSpecifier(spec);
      if (key) entryRuntimeImports.add(key);
      else unresolvedEntryImports.push(`${relative(DIST, file)} -> ${spec}`);
    }
  }

  const shared = staticClosure(manifest, [...preloaded, ...entryRuntimeImports]);
  const moduleClosure = staticClosure(manifest, moduleFiles);
  const exclusive = new Set([...moduleClosure].filter((k) => !shared.has(k)));
  const entryClosure = staticClosure(manifest, entryRuntimeImports);
  const exclusiveOfEntry = new Set([...moduleClosure].filter((k) => !entryClosure.has(k)));

  return {
    exclusiveOfEntry,
    manifest,
    base,
    moduleFiles,
    preloaded,
    unresolvedPreloads,
    entryLocalFiles,
    entryRuntimeImports,
    unresolvedEntryImports,
    shared,
    moduleClosure,
    exclusive,
  };
}

/** The exclusive closure minus the module's own re-export files: the chunks that carry its body. */
function exclusiveBodyChunks(ev: RuntimeEvidence): string[] {
  return [...ev.exclusive].filter((k) => !ev.moduleFiles.has(k)).sort();
}

describe("QA-F13-G13 · the switcher is tree-shaken out of a production build", () => {
  it("PREREQUISITE · a production build exists to inspect", () => {
    // Named rather than skipped. A missing dist makes every marker count zero,
    // which reads exactly like a clean bundle.
    expect(
      existsSync(ASSETS),
      `no production build at ${ASSETS}. Run \`npm run build\` before this suite — ` +
        "a bundle-grep case whose bundle does not exist reports zero markers, which " +
        "is indistinguishable from a perfect tree-shake.",
    ).toBe(true);
    expect(emittedScripts(ASSETS).length).toBeGreaterThan(0);
  });

  it.skipIf(IS_RUNTIME_BUILD)(
    "POSITIVE CONTROL · the markers EXIST to be found somewhere in the emitted output",
    () => {
      // R2. Without this, every "absent from the entry bundle" assertion below would
      // also pass against a build where the switcher was never wired at all — which
      // is a different defect wearing the same green.
      const all = emittedScripts(ASSETS)
        .map((f) => readFileSync(f, "utf8"))
        .join("\n");
      for (const marker of [...SWITCHER_MARKERS, ICON_MARKER]) {
        expect(
          all,
          `"${marker}" appears NOWHERE in the emitted output. Either the switcher is ` +
            "not wired at all, or these markers no longer identify it — and in both " +
            "cases the absence assertions below prove nothing.",
        ).toContain(marker);
      }
    },
  );

  it("the ENTRY bundle carries no switcher, no icon dependency and no preset URL", () => {
    // The entry is what every visitor to a published experience downloads
    // unconditionally. The switcher must not be in it.
    const entries = emittedScripts(ASSETS).filter((f) => /\/main-[^/]+\.js$/.test(f));
    expect(entries.length, "expected exactly one entry bundle").toBeGreaterThan(0);

    for (const entry of entries) {
      const code = readFileSync(entry, "utf8");
      for (const marker of SWITCHER_MARKERS) {
        // A bare dynamic-import SPECIFIER naming the chunk is expected and fine;
        // the switcher's own CODE is what must not be inlined here.
        expect(code, `the entry bundle inlines "${marker}"`).not.toContain(marker);
      }
      expect(code, "the entry bundle inlines the icon dependency").not.toContain(ICON_MARKER);
      for (const asset of PRESET_ASSETS) {
        expect(code, `the entry bundle inlines the preset URL "${asset}"`).not.toContain(asset);
      }
    }
  });

  it.skipIf(IS_RUNTIME_BUILD)(
    "the switcher is reached only through a code-split chunk, never preloaded",
    () => {
      // The load-bearing property: a visitor who never triggers the framed path
      // never downloads the switcher. A `<link rel="modulepreload">` or a static
      // import would defeat that while leaving the entry-bundle assertion green.
      const html = readFileSync(INDEX_HTML, "utf8");
      expect(
        html,
        "index.html preloads the media-source chunk, so every visitor downloads the " +
          "switcher whether or not any code path needs it",
      ).not.toMatch(/media-source/);

      const chunks = emittedScripts(ASSETS).filter((f) => /media-source/.test(f));
      expect(
        chunks.length,
        "the switcher must live in its OWN code-split chunk; inlined into a shared " +
          "chunk it ships with whatever else that chunk carries",
      ).toBe(1);
    },
  );

  it("the guarded switcher mount is not statically reachable from application source", () => {
    // The SEAM that makes the tree-shake achievable, asserted at the source rather
    // than the bundle: `import(...)` inside an effect behind a constant guard,
    // never a top-level `import ... from`. A static import defeats every bundler.
    const control = readFileSync(join(process.cwd(), "src/MediaSourceControl.tsx"), "utf8");
    expect(
      control,
      "MediaSourceControl must not statically import the SDK's media-source module",
    ).not.toMatch(/^\s*import\s[^\n]*@vincentt-xr\/sdk\/debug-ui\/media-source/m);
    expect(control).toMatch(/import\(\s*["']@vincentt-xr\/sdk\/debug-ui\/media-source["']\s*\)/);
  });

  it.skipIf(IS_RUNTIME_BUILD)(
    "REPORTED · the framed-preset path pulls the same chunk in production, switcher and all",
    () => {
      // A FINDING, recorded as an assertion so it cannot be lost.
      //
      // `enabled` defaults to `import.meta.env.DEV`, so the SWITCHER's own mount is
      // dead in a published bundle. But the framed-preset startup path imports the
      // SAME module for `sdkVideoMediaSources`, and that path is live in production.
      // So a published bundle that is ever framed fetches a chunk carrying the
      // switcher component, the icon dependency and all 12 preset URLs.
      //
      // This is NOT the static-import defect G13 primarily guards — the chunk is
      // code-split and is never downloaded by an ordinary unframed visitor, which is
      // the property that actually protects a creator's shipped experience. It is
      // recorded because the record's wording ("a production build contains NO
      // MediaSourceSwitcher, no icon dependency and none of the 12 preset CDN URLs")
      // is stricter than what the design can deliver: a framed app NEEDS a preset,
      // and the preset list ships beside the switcher in one SDK entry point.
      //
      // Splitting them is an SDK change, and this feature budgets the SDK at ZERO
      // change — so this asserts the reachable truth rather than failing a correct
      // implementation against an unachievable wording. See the QA report's
      // FINDING-3.
      const chunk = emittedScripts(ASSETS).find((f) => /media-source/.test(f));
      expect(chunk, "the media-source chunk must exist").toBeDefined();
      const code = readFileSync(chunk!, "utf8");
      expect(code).toContain("Open Media Menu");
      expect(code).toContain("sdkVideoMediaSources");

      // The bound that keeps this acceptable: the chunk stays SMALL and SEPARATE.
      // If it ever merges into the entry bundle the case above fails; if it grows
      // past a debug-UI's worth of bytes, that is a signal worth reading.
      const kb = statSync(chunk!).size / 1024;
      expect(kb, `the media-source chunk is ${kb.toFixed(1)}kb`).toBeLessThan(64);
    },
  );

  describe.runIf(IS_RUNTIME_BUILD)("runtime build (f23 shared runtime)", () => {
    it("POSITIVE CONTROL · the runtime graph is read, and the module has a body of its own", () => {
      // The runtime replacement for the marker control. Every absence assertion
      // below is a set lookup in the manifest's graph; if the import map, the
      // preload hrefs or the entry's imports stopped resolving to manifest keys,
      // every set would be empty and every case would pass on nothing.
      const ev = loadRuntimeEvidence();
      const exportsOfModule = ev.manifest.exports[SPEC] ?? {};
      expect(Object.keys(exportsOfModule), `the manifest exports nothing for ${SPEC}`).toEqual(
        expect.arrayContaining(["MediaSourceSwitcher", "sdkVideoMediaSources"]),
      );
      for (const file of ev.moduleFiles) {
        expect(ev.manifest.sizes[file], `the manifest has no size for ${file}`).toBeGreaterThan(0);
      }
      expect(IMPORT_MAP?.integrity?.[`${ev.base}${ev.manifest.specifiers[SPEC]}`]).toMatch(
        /^sha384-/,
      );

      expect(ev.preloaded.size, "no runtime file is preloaded; the preload set is empty").toBeGreaterThan(0);
      expect(ev.unresolvedPreloads, "runtime preloads that resolve to no manifest key").toEqual([]);
      expect(ev.entryRuntimeImports.size, "the entry imports nothing from the runtime").toBeGreaterThan(0);
      expect(ev.unresolvedEntryImports, "entry imports that resolve to nothing").toEqual([]);

      expect(
        exclusiveBodyChunks(ev).length,
        "the media-source module has no chunk of its own: its body ships inside chunks " +
          "every visitor already downloads, or the graph was not read",
      ).toBeGreaterThan(0);
    });

    it("the media-source module and its exclusive chunks are never preloaded", () => {
      const ev = loadRuntimeEvidence();
      const forbidden = new Set([...ev.moduleFiles, ...ev.exclusiveOfEntry]);
      expect(exclusiveBodyChunks(ev).every((k) => forbidden.has(k))).toBe(true);
      const preloadedForbidden = [...ev.preloaded].filter((k) => forbidden.has(k)).sort();
      expect(
        preloadedForbidden,
        "index.html preloads the media-source module or a chunk only it needs, so every " +
          "visitor downloads the switcher whether or not any code path needs it",
      ).toEqual([]);
      const anyMediaSourceHref = hrefs(HTML, "modulepreload").filter((h) => /media-source/.test(h));
      expect(anyMediaSourceHref, "a modulepreload names the media-source module").toEqual([]);
    });

    it("the media-source module is not in the static closure of the entry or the preloaded runtime files", () => {
      const ev = loadRuntimeEvidence();
      const reached = [...ev.moduleFiles].filter((k) => ev.shared.has(k)).sort();
      expect(
        reached,
        "the media-source module is statically reachable from what every visitor " +
          "downloads up front, so its whole closure ships unconditionally",
      ).toEqual([]);
      // The module's body chunks are known only as "reachable through it and through
      // nothing up front". If a static import or preload pulls the body chunk in,
      // that set empties; so an empty set here IS the defect, not a vacuous pass.
      expect(
        exclusiveBodyChunks(ev).length,
        "every chunk the media-source module imports is already reachable from the " +
          "entry or a preload, so the switcher body ships to every visitor",
      ).toBeGreaterThan(0);
    });

    it("the entry reaches the module only through a dynamic import, never a static one", () => {
      const ev = loadRuntimeEvidence();
      const moduleUrls = [...ev.moduleFiles].map((f) => `${ev.base}${f}`);
      let dynamicHits = 0;
      for (const file of ev.entryLocalFiles) {
        const code = readFileSync(file, "utf8");
        const statics = staticSpecifiers(code);
        expect(statics, `${relative(DIST, file)} statically imports ${SPEC}`).not.toContain(SPEC);
        for (const url of moduleUrls) {
          expect(statics, `${relative(DIST, file)} statically imports ${url}`).not.toContain(url);
        }
        if (dynamicSpecifiers(code).includes(SPEC)) dynamicHits++;
      }
      expect(
        dynamicHits,
        `no file in the entry's static closure has import("${SPEC}"); the switcher is ` +
          "either unwired or reached some other way",
      ).toBeGreaterThan(0);
    });

    it("no file in dist carries the switcher's copy, the icon dependency or a preset URL", () => {
      // In a runtime build the module's body lives on the runtime origin, so none of
      // it may appear in the creator's own uploaded bytes.
      const files = distTextFiles(DIST);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        for (const marker of [...SWITCHER_MARKERS, ICON_MARKER, ...PRESET_ASSETS]) {
          expect(text.includes(marker), `${relative(DIST, file)} carries "${marker}"`).toBe(false);
        }
      }
    });

    it("REPORTED · the framed-preset path pulls the same module, switcher and all, from the runtime", () => {
      // FINDING-3, restated for the shared runtime. The framed-preset startup path
      // reads `sdkVideoMediaSources` from the SAME specifier the switcher lives
      // behind, so a framed published app fetches the module's whole exclusive
      // closure, switcher included. An ordinary unframed visitor still fetches none
      // of it (the cases above). The bound keeps that framed-only cost small.
      const ev = loadRuntimeEvidence();
      expect(Object.keys(ev.manifest.exports[SPEC] ?? {})).toEqual(
        expect.arrayContaining(["MediaSourceSwitcher", "sdkVideoMediaSources"]),
      );
      const entry = readFileSync(entryScriptPath(HTML), "utf8");
      expect(entry).toContain("sdkVideoMediaSources");
      expect(dynamicSpecifiers(entry)).toContain(SPEC);

      // What a framed visit fetches is the specifier's own file and its static
      // closure, less what the page already holds. The per-export alias files are
      // separate entry points the import map never names, so they are not counted.
      const specFile = ev.manifest.specifiers[SPEC];
      const files = [...staticClosure(ev.manifest, [specFile])].filter((k) => !ev.shared.has(k)).sort();
      expect(files.length, "the framed path fetches nothing beyond the re-export file").toBeGreaterThan(1);
      const bytes = files.reduce((n, k) => n + (ev.manifest.sizes[k] ?? 0), 0);
      const kb = bytes / 1024;
      // The manifest's sizes run smaller than the files' raw bytes (compressed
      // sizes), so this bound is deliberately tighter than the 64kb raw bound the
      // self-contained case holds the local chunk to.
      expect(
        kb,
        `the framed path fetches ${kb.toFixed(1)}kb by the manifest's sizes ` +
          `(${files.length} files: ${files.join(", ")})`,
      ).toBeLessThan(32);
    });
  });
});
