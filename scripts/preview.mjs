/**
 * Live preview for on-device testing. Thin CLI wrapper over the harness's
 * startPreview(), which stands up the app dev serve, the diagnostics relay, a
 * front proxy unifying them on one origin, and a cloudflared tunnel — so the phone
 * gets ONE https URL that serves both the app (secure context → live camera) and
 * the diagnostics socket. The same orchestration backs `vincentt preview` and
 * the MCP `preview_start` verb, so the CLI and the agent path stay identical.
 *
 * Usage: `npm run preview` (tunnel, any network). cloudflared is used for the
 * tunnel; if it isn't on PATH the harness provisions a copy automatically.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPreview } from "@vincentt-xr/cli/preview";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let preview;
try {
  preview = await startPreview({
    projectCwd: root,
    appPort: Number(process.env.PORT) || 5173,
    frontPort: Number(process.env.PREVIEW_PORT) || 5190,
    // The app's dev serve reads $PORT; run it directly so build output stays visible.
    devCommand: ["node", "scripts/dev.mjs"],
    appStdio: "inherit",
    onLog: (m) => console.log(m),
  });
} catch (err) {
  console.error(`\n  ✗ ${err.message}\n`);
  process.exit(1);
}

console.log(`\n  Live preview (with diagnostics) — open on your device:\n\n  ${preview.url}\n`);
console.log(`  Agent: vincentt logs | network | trace  ·  vincentt feedback --wait\n`);

const stop = async () => {
  await preview.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
