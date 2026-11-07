/**
 * esbuild config for the local dev server (`scripts/dev.mjs`). The production
 * build is `vincentt build`, which uses its own fixed options and never reads
 * this file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import stylePlugin from "esbuild-style-plugin";

const require = createRequire(import.meta.url);
const repoRoot = path.dirname(fileURLToPath(import.meta.url));

// Packages that MUST resolve to a single instance. Two React instances give
// "Cannot read properties of null (reading 'useMemo')"; two fiber instances
// break the <Canvas> R3F context ("Hooks can only be used within the Canvas").
// With the SDK installed as a tarball these hoist to one copy on their own, but
// pinning here is cheap insurance against a transitive dep (or a symlinked dev
// SDK) pulling a second copy. Pin each to this repo's own copy.
const SINGLETONS = [
  "react",
  "react-dom",
  "scheduler",
  "three",
  "@react-three/fiber",
  "@react-three/drei",
  "react-reconciler",
  "its-fine",
];

// Resolve a package to its install DIRECTORY (the dir holding its package.json),
// not its main file — aliasing to a file breaks subpath imports like
// "react-dom/client". esbuild dedups by directory and resolves subpaths itself.
function pkgDir(localRequire, pkg) {
  const pkgJson = localRequire.resolve(`${pkg}/package.json`);
  return path.dirname(pkgJson);
}

const SDK_PKG = "@vincentt-sdks/xr-sdk";

// Dev-only SDK link: `SDK_LINK=1 npm run dev` resolves the SDK to a local xr-sdk
// checkout (its built dist/) instead of the pinned tarball, so SDK edits show up
// in the app's dev loop without publish→repin→reinstall. Run `pnpm build:watch`
// in xr-sdk alongside so dist/ rebuilds on change. `SDK_LINK=1` uses the sibling
// `../xr-sdk`; `SDK_LINK=/abs/path/to/xr-sdk` overrides. Resolves to the package
// DIRECTORY (esbuild reads its exports → dist/main.js), and the SINGLETONS pins
// above keep the linked SDK from dragging a second React/three. Never affects the
// publish build (SDK_LINK unset) — the tarball remains the source of truth.
function linkedSdkDir() {
  const link = process.env.SDK_LINK;
  if (!link) return undefined;
  const dir = link === "1" ? path.resolve(repoRoot, "..", "xr-sdk") : path.resolve(link);
  return dir;
}

export function aliasMap(root = repoRoot) {
  const localRequire = createRequire(path.join(root, "package.json"));
  const singletons = {};
  for (const pkg of SINGLETONS) {
    try {
      singletons[pkg] = pkgDir(localRequire, pkg);
    } catch {
      // Not installed (e.g. optional dep) — skip; esbuild resolves normally.
    }
  }
  const sdkLink = linkedSdkDir();
  return {
    ...singletons,
    ...(sdkLink ? { [SDK_PKG]: sdkLink } : {}),
  };
}

// The three hosts a viewer beacon may be sent to, as literals. This list IS the
// constraint: `@vincentt-xr/analytics` ships a pre-built dist, so the endpoint can
// only be chosen at the creator's build, and the value must not be free-form.
// A creator's own repo config naming an arbitrary host would redirect their
// viewers' beacons to it, and a published bundle is unfixable afterward.
//
// Keyed by environment rather than parsed, so nothing here matches or derives a
// host. The publish apexes NEST (`vincentt.app` is a suffix of
// `staging.vincentt.app`), which is exactly why this is a lookup and not a suffix
// test — see internal/meter/host.go in the api repo for what that costs.
//
// This prevents a MISTAKE, not an attacker: the creator owns this build and can
// edit dist by hand. That is true of every byte in the bundle. Do not describe
// this as a security boundary.
const BEACON_ENDPOINTS = {
  production: "https://api.vincentt.studio/v/beacon",
  staging: "https://api.staging.vincentt.studio/v/beacon",
  dev: "https://api.dev.vincentt.studio/v/beacon",
};

// Unset means production, so an ordinary creator build is byte-identical to the
// one that shipped before this existed. An unrecognized value FAILS THE BUILD
// rather than falling back: a typo'd `VINCENTT_ENV=stagng` that silently built a
// production beacon is the failure this whole change exists to remove.
function beaconEndpointDefine() {
  const env = process.env.VINCENTT_ENV;
  if (!env) return {};
  const endpoint = BEACON_ENDPOINTS[env];
  if (!endpoint) {
    throw new Error(
      `VINCENTT_ENV=${JSON.stringify(env)} is not a known environment. ` +
        `Expected one of: ${Object.keys(BEACON_ENDPOINTS).join(", ")}. ` +
        `Leave it unset for a normal production build.`,
    );
  }
  return { "globalThis.__VCT_BEACON__": JSON.stringify(endpoint) };
}

// Vite's `import.meta.env`, populated the way Vite would, as TWO kinds of define.
//
// The object define serves code that reads the object itself (`env =
// import.meta.env`, the injectable `env` prop on `MediaSourceBinder`). The
// per-key defines are what make `if (import.meta.env.DEV)` DEAD CODE in a
// production build: esbuild constant-folds a member access only when that exact
// expression is defined as a literal. A member read off a defined OBJECT stays a
// runtime property lookup, so a guard on it shipped its dev-only branch — a clip
// loader, its 5 MB video and a debug overlay reached a published bundle that way
// (vincentt-xr/v2-template#112). `process.env.NODE_ENV` was already a literal and
// already folded; now both guards do. The per-key form wins where both match.
//
// `scripts/import-meta-env-fold.test.mjs` builds a probe through this exact map
// and asserts the guarded branch is absent in production and present in dev.
export function importMetaEnvValues(prod, viteVars = {}) {
  return {
    ...viteVars,
    MODE: prod ? "production" : "development",
    PROD: prod,
    DEV: !prod,
    BASE_URL: "/",
  };
}

export function importMetaEnvDefine(prod, viteVars = {}) {
  const env = importMetaEnvValues(prod, viteVars);
  const define = { "import.meta.env": JSON.stringify(env) };
  for (const [key, value] of Object.entries(env)) {
    define[`import.meta.env.${key}`] = JSON.stringify(value);
  }
  return define;
}

// `VITE_*` variables, the way Vite exposes them on `import.meta.env`.
//
// Read from the process environment and from the repo's env files, so the
// documented one-liner works as written:
//
//   VITE_INPUT_SOURCE=video VITE_INPUT_URL=/clip.mp4 pnpm dev
//
// and so a clip a creator develops against can live in a file instead of on
// every command line. Files, in the order Vite reads them, later overriding
// earlier and the process environment overriding every file:
//
//   .env  →  .env.local  →  .env.<mode>  →  .env.<mode>.local
//
// `.env.development` is where a dev-only clip belongs. The production build
// (`vincentt build`) reads no env file and defines no `VITE_*` key, so no clip
// reaches a published bundle through this map. Only `VITE_`-prefixed keys cross
// into the dev bundle; nothing else from the environment is exposed
// (vincentt-xr/v2-template#113).
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    const quoted = /^(['"`])([\s\S]*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

export function viteEnvVars({ mode, root = repoRoot, processEnv = process.env, readFile } = {}) {
  const read =
    readFile ??
    ((file) => {
      try {
        return fs.readFileSync(path.join(root, file), "utf8");
      } catch {
        return undefined;
      }
    });
  const merged = {};
  for (const file of [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`]) {
    const text = read(file);
    if (text) Object.assign(merged, parseEnvFile(text));
  }
  Object.assign(merged, processEnv);
  const vite = {};
  for (const [key, value] of Object.entries(merged)) {
    if (!key.startsWith("VITE_") || value === undefined) continue;
    // Each key becomes a define `import.meta.env.<KEY>`, which esbuild parses as
    // an expression: a key that is not an identifier would fail the build with
    // an error pointing nowhere near the env file.
    if (!/^VITE_[A-Za-z0-9_]+$/.test(key)) {
      console.warn(`env: ignoring ${JSON.stringify(key)} — a VITE_ key must be an identifier`);
      continue;
    }
    vite[key] = String(value);
  }
  return vite;
}

export function buildOptions({ mode = "production", root = repoRoot } = {}) {
  const prod = mode === "production";
  const viteVars = viteEnvVars({ mode, root });
  return {
    entryPoints: [path.join(root, "src", "main.tsx")],
    bundle: true,
    format: "esm",
    splitting: true,
    outdir: path.join(root, "dist", "assets"),
    entryNames: "[name]-[hash]",
    chunkNames: "chunks/[name]-[hash]",
    assetNames: "[name]-[hash]",
    publicPath: "/assets",
    minify: prod,
    sourcemap: !prod,
    target: ["es2020"],
    jsx: "automatic",
    // Development builds carry each element's source location (React 18's
    // `_debugSource`), which the desktop editor maps back to the JSX it came
    // from. Off in production: the published bundle must not change.
    jsxDev: !prod,
    loader: {
      ".png": "file",
      ".jpg": "file",
      ".jpeg": "file",
      ".svg": "file",
      ".gif": "file",
      ".webp": "file",
      ".mp4": "file",
      ".glb": "file",
      ".gltf": "file",
      ".hdr": "file",
      ".woff": "file",
      ".woff2": "file",
    },
    alias: aliasMap(root),
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        prod ? "production" : "development",
      ),
      "globalThis.VCT_MOBILE_XR_ACCEPTANCE_HARNESS": JSON.stringify(
        process.env.VITE_MOBILE_XR_ACCEPTANCE_HARNESS === "true",
      ),
      ...importMetaEnvDefine(prod, viteVars),
      ...beaconEndpointDefine(),
    },
    plugins: [
      stylePlugin({ postcss: { plugins: [require("@tailwindcss/postcss")] } }),
    ],
    metafile: true,
    logLevel: "info",
  };
}
