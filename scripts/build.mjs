/**
 * Server-side production build. Bundles with esbuild and emits a hashed
 * index.html. Mirrors the in-browser preview (same esbuild.config).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { buildOptions } from "../esbuild.config.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, "dist");

await fs.rm(distDir, { recursive: true, force: true });
const result = await esbuild.build(buildOptions({ mode: "production", root }));

// Mirror /public into dist so root-relative refs (favicon, og:image, fonts)
// are served by the published bundle.
const publicDir = path.join(root, "public");
try {
  await fs.cp(publicDir, distDir, { recursive: true });
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

let js = "";
let css = "";
for (const [out, meta] of Object.entries(result.metafile.outputs)) {
  const rel =
    "/" + path.relative(distDir, path.resolve(out)).split(path.sep).join("/");
  if (meta.entryPoint?.endsWith("main.tsx") && rel.endsWith(".js")) js = rel;
  if (rel.endsWith(".css")) css = rel;
}

let html = await fs.readFile(path.join(root, "index.html"), "utf8");
html = html.replace(
  /<link[^>]+href="\/src\/index\.css"[^>]*>/,
  css ? `<link rel="stylesheet" href="${css}" />` : "",
);
html = html.replace(
  /<script[^>]+src="\/src\/main\.tsx"[^>]*><\/script>/,
  `<script type="module" src="${js}"></script>`,
);
await fs.writeFile(path.join(distDir, "index.html"), html);

console.log("build complete:", js);
