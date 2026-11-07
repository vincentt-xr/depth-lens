/**
 * Local dev server via esbuild context + serve. Watches src/, rebuilds, and
 * serves `.dev/`. (In the editor, the in-browser esbuild-wasm preview is used
 * instead; this is for standalone local development of the template.)
 *
 * `.dev/` IS NOT `dist/`. `pnpm build` wipes and rewrites `dist/`, and this
 * server used to serve that same folder — so a build run while dev was up made
 * the dev page silently load the production bundle (dev-only input and overlays
 * gone, which reads as a camera bug), and `vincentt publish` could upload a dev
 * bundle a stray `pnpm dev` had left in `dist/`. A separate, gitignored output
 * folder removes both: the dev page only ever serves dev output, `dist/` only
 * ever holds a production build, and the tree-shake suite that reads `dist/`
 * never meets a dev build (vincentt-xr/v2-template#114).
 *
 * Unlike the production build, dev output is unhashed so `.dev/index.html` can
 * reference stable filenames (`main.js`, `main.css`). Without this, the HTML
 * on disk only matches the bundle from the last build; subsequent dev rebuilds
 * emit fresh hashed files and the HTML keeps pointing at stale ones — the
 * browser loads pre-edit code with no obvious signal.
 *
 * THE ADDRESS. esbuild's server binds one address family: its default is IPv4
 * (`0.0.0.0`), and asking for `::` makes it refuse IPv4 requests outright. A
 * browser that resolves `localhost` to `::1` — the embedded preview browser
 * does — then gets connection refused at the address AGENTS.md names. So
 * esbuild listens privately on an ephemeral `127.0.0.1` port, and this script
 * fronts it with two loopback listeners, `127.0.0.1:5173` and `[::1]:5173`,
 * forwarding every request (the live-reload event stream included). `localhost`
 * works whichever family the client picks (vincentt-xr/v2-template#115).
 *
 * Loopback only by default. Set `HOST=0.0.0.0` (or a LAN address) to listen on
 * one explicit address instead, e.g. to open the dev page from a phone on the
 * same network. `pnpm preview` does not need that: the CLI tunnels to this
 * machine's loopback.
 */
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { buildOptions } from "../esbuild.config.mjs";
import { applyAppMetadata, readAppConfig } from "./app-metadata.mjs";
import { devIndexHtml } from "./dev-html.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const devDir = path.join(root, ".dev");

const opts = buildOptions({ mode: "development", root });

await fs.rm(devDir, { recursive: true, force: true });
await fs.mkdir(devDir, { recursive: true });
// Mirror /public into the served folder so root-relative refs (favicon,
// og:image, fonts) resolve. esbuild's `serve` only exposes its build output,
// not the source tree.
const publicDir = path.join(root, "public");
try {
  await fs.cp(publicDir, devDir, { recursive: true });
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

// The creator's title, description and share image come from app.config.json
// (their file), not from index.html (ours). See scripts/app-metadata.mjs.
// The page also carries live reload; see scripts/dev-html.mjs.
const html = devIndexHtml(
  applyAppMetadata(await fs.readFile(path.join(root, "index.html"), "utf8"), readAppConfig(root)),
);
await fs.writeFile(path.join(devDir, "index.html"), html);

const ctx = await esbuild.context({
  ...opts,
  outdir: path.join(devDir, "assets"),
  splitting: false,
  metafile: false,
  entryNames: "[name]",
  chunkNames: "chunks/[name]",
  assetNames: "[name]",
});
await ctx.watch();

// esbuild's own listener: IPv4 loopback, ephemeral port, never printed. Every
// public address below forwards to it.
const upstream = await ctx.serve({ servedir: devDir, host: "127.0.0.1", port: 0 });
const upstreamHost = upstream.hosts?.[0] ?? upstream.host ?? "127.0.0.1";
const upstreamPort = upstream.port;

const port = Number(process.env.PORT) || 5173;
const explicitHost = process.env.HOST;

/**
 * The Host values a request may carry. esbuild refuses any other Host — its
 * defence against DNS rebinding, where a page on an attacker's hostname that
 * resolves to 127.0.0.1 reads the dev bundle, source maps and public/ through
 * the victim's browser. Rewriting Host for the upstream would discard that
 * defence, so the forwarder enforces the same allowlist first: the loopback
 * names, an explicit HOST, and — when HOST is an any-address — this machine's
 * own interface addresses, which is what esbuild allows. `localhost:<port>` is
 * what the `vincentt preview` proxy sends, so it is always in.
 */
function allowedHosts() {
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (explicitHost) {
    // Lowercased, because the check below lowercases the header a browser sends.
    const h = explicitHost.toLowerCase();
    hosts.add(h.includes(":") ? `[${h}]` : h);
    if (explicitHost === "0.0.0.0" || explicitHost === "::") {
      for (const addrs of Object.values(os.networkInterfaces())) {
        for (const { address, family } of addrs ?? []) {
          hosts.add(family === "IPv6" || family === 6 ? `[${address}]` : address);
        }
      }
    }
  }
  return hosts;
}
const ALLOWED_HOSTS = allowedHosts();

function hostAllowed(header) {
  if (!header) return false;
  const value = header.trim().toLowerCase();
  const name = value.startsWith("[")
    ? value.slice(0, value.indexOf("]") + 1)
    : value.replace(/:\d+$/, "");
  const suffix = value.slice(name.length);
  // Deliberately tighter than esbuild, which ignores the port: a Host naming
  // another port is not this server's, whoever sends it.
  if (suffix !== "" && suffix !== `:${port}`) return false;
  return ALLOWED_HOSTS.has(name);
}

/**
 * A request forwarder. Streams both directions, so esbuild's `/esbuild`
 * live-reload event stream stays open. After the allowlist above, the Host
 * header is rewritten to the upstream's own address, which is the only Host
 * esbuild's private listener recognises.
 */
function forwarder() {
  return http.createServer((req, res) => {
    if (!hostAllowed(req.headers.host)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end(`403 - Forbidden: Host "${req.headers.host ?? ""}" is not allowed by the dev server`);
      return;
    }
    const headers = { ...req.headers, host: `${upstreamHost}:${upstreamPort}` };
    const up = http.request(
      { host: upstreamHost, port: upstreamPort, method: req.method, path: req.url, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    up.on("error", (err) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(`dev server upstream error: ${err.message}`);
    });
    req.pipe(up);
  });
}

const servers = [];

/** Resolves to the bound address, or to `undefined` when the family is unavailable. */
function listen(address) {
  return new Promise((resolve, reject) => {
    const server = forwarder();
    server.once("error", (err) => {
      // No IPv6 on this machine (or the family is disabled): not an error for
      // the address that is there. Anything else — the port in use, most
      // likely — is, and is reported below rather than thrown.
      if (err.code === "EADDRNOTAVAIL" || err.code === "EAFNOSUPPORT") resolve(undefined);
      else reject(err);
    });
    server.listen(port, address, () => {
      servers.push(server);
      resolve(address);
    });
  });
}

/** One line for the developer-facing path, plus the sign-in / binding hint when it is missing. */
function platformNote() {
  const lines = [
    "  for your own checks only — the developer sees the app through `pnpm preview` (console page)",
  ];
  try {
    const home = os.homedir();
    const config = JSON.parse(readFileSync(path.join(home, ".vincentt", "config.json"), "utf8"));
    if (!config.pat) lines.push("  not signed in: run `vincentt login` first");
    const here = path.resolve(process.cwd());
    const bound = readFileSync(path.join(home, ".vincentt", "locations.ndjson"), "utf8")
      .split("\n")
      .filter(Boolean)
      .some((line) => {
        try {
          return path.resolve(JSON.parse(line).d) === here;
        } catch {
          return false;
        }
      });
    if (!bound) lines.push("  not bound to a project: run `vincentt create` here (or `vincentt link <project-id>`)");
  } catch {
    lines.push("  not signed in: run `vincentt login`, then `vincentt create` here");
  }
  return lines.join("\n");
}

const addresses = explicitHost ? [explicitHost] : ["127.0.0.1", "::1"];
let bound;
try {
  bound = (await Promise.all(addresses.map(listen))).filter(Boolean);
} catch (err) {
  // One family failed for real; do not leave the other one half-up.
  for (const server of servers) server.close();
  await ctx.dispose();
  console.error(
    err.code === "EADDRINUSE"
      ? `dev server: port ${port} is already in use (another dev server? set PORT=<other> to pick another)`
      : `dev server: could not listen on port ${port}: ${err.message}`,
  );
  process.exit(1);
}
if (bound.length === 0) {
  await ctx.dispose();
  console.error(`dev server: could not bind ${addresses.join(" or ")} on port ${port}`);
  process.exit(1);
}

const shown = explicitHost
  ? `http://${explicitHost.includes(":") ? `[${explicitHost}]` : explicitHost}:${port}`
  : `http://localhost:${port}`;
// esbuild prints its own `Local: http://127.0.0.1:<ephemeral>/` line above
// this one; that is the private upstream, not the address to open.
console.log(`dev server: ${shown}`);
if (!explicitHost) {
  const families = bound.map((a) => (a === "::1" ? "[::1]" : a)).join(" and ");
  console.log(`  listening on ${families}, port ${port}; output in .dev/`);
}
// The platform is the developer's path; this address is the agent's. Say so on
// every start, and when the machine is not signed in or this folder is not bound
// to a project, say what fixes it. Best effort: nothing here can stop the server.
console.log(platformNote());
if (process.env.SDK_LINK) {
  const linked =
    process.env.SDK_LINK === "1" ? "../xr-sdk" : process.env.SDK_LINK;
  console.log(`SDK linked → ${linked} (run \`pnpm build:watch\` there)`);
}
