/**
 * Local dev server via esbuild context + serve. Watches src/, rebuilds, and
 * serves dist/. (In the editor, the in-browser esbuild-wasm preview is used
 * instead; this is for standalone local development of the template.)
 *
 * Unlike the production build, dev output is unhashed so `dist/index.html` can
 * reference stable filenames (`main.js`, `main.css`). Without this, the HTML
 * on disk only matches the bundle from the last `build.mjs` run; subsequent
 * dev rebuilds emit fresh hashed files and the HTML keeps pointing at stale
 * ones — the browser loads pre-edit code with no obvious signal.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { buildOptions } from "../esbuild.config.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, "dist");

const opts = buildOptions({ mode: "development", root });

await fs.mkdir(distDir, { recursive: true });
// Mirror /public into dist so root-relative refs (favicon, og:image, fonts)
// resolve. esbuild's `serve` only exposes its build output, not the source
// tree.
const publicDir = path.join(root, "public");
try {
  await fs.cp(publicDir, distDir, { recursive: true });
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

let html = await fs.readFile(path.join(root, "index.html"), "utf8");
html = html.replace(
  /<link[^>]+href="\/src\/index\.css"[^>]*>/,
  `<link rel="stylesheet" href="/assets/main.css" />`,
);
html = html.replace(
  /<script[^>]+src="\/src\/main\.tsx"[^>]*><\/script>/,
  `<script type="module" src="/assets/main.js"></script>`,
);
await fs.writeFile(path.join(distDir, "index.html"), html);

const ctx = await esbuild.context({
  ...opts,
  splitting: false,
  metafile: false,
  entryNames: "[name]",
  chunkNames: "chunks/[name]",
  assetNames: "[name]",
});
await ctx.watch();
const port = Number(process.env.PORT) || 5173;
const { host, port: actualPort } = await ctx.serve({
  servedir: distDir,
  port,
});
console.log(`dev server: http://${host || "127.0.0.1"}:${actualPort}`);
if (process.env.SDK_LINK) {
  const linked =
    process.env.SDK_LINK === "1" ? "../xr-sdk" : process.env.SDK_LINK;
  console.log(`SDK linked → ${linked} (run \`pnpm build:watch\` there)`);
}
