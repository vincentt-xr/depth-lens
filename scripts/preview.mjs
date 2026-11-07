/**
 * Live preview for on-device testing — a thin wrapper over `vincentt preview`.
 *
 * The CLI owns the whole orchestration: it resolves this folder's project
 * binding and the machine config, mints the session, then stands up the app dev
 * serve, the diagnostics relay, a front proxy unifying them on one origin, and
 * the edge tunnel client — so the phone gets ONE https URL that serves both the
 * app (secure context → live camera) and the diagnostics socket.
 *
 * This script deliberately does NOT call the CLI's startPreview() directly.
 * That entry point takes an already-resolved config and projectId, so calling it
 * from here meant re-implementing the CLI's binding and config resolution in the
 * template — where it silently drifted and broke every scaffolded project's
 * `npm run preview`. Spawning the command is what keeps the two paths identical.
 *
 * The CLI runs the app with `npm run dev`, which is this template's dev script.
 *
 * Usage: `npm run preview` (tunnel, any network). The tunnel terminates on
 * Vincentt's own edge, whose address is minted per session by the API, so this
 * needs a signed-in CLI (`vincentt login`). Nothing extra to install.
 *
 * The bare `vincentt` is tried first and `npx @vincentt-xr/cli` is the fallback
 * when the shell cannot resolve it. A global install that succeeded is still
 * unreachable from a process whose PATH does not carry npm's global bin — the
 * modal case being a desktop app, which inherits the PATH it was launched with
 * rather than a terminal's. Reinstalling does not fix that, so the old remedy
 * here (install it globally) sent an agent round a loop it could not leave.
 */
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = ["preview"];
if (process.env.PORT) args.push("--port", process.env.PORT);

// Windows: an npm-installed binary is a `.cmd` shim, which spawn resolves only
// through a shell.
const useShell = process.platform === "win32";

// The shell-path fallback fires on a non-zero exit, which a REAL preview failure
// also produces. This is what keeps the two apart: once any output has reached
// the terminal the command was found and ran, so its failure is its own and
// retrying it under npx would run a broken preview twice and blame the wrong
// thing. A command the shell never resolved prints nothing first.
let started = false;

function run(command, commandArgs) {
  const child = spawn(command, commandArgs, {
    cwd: root,
    stdio: useShell ? ["inherit", "pipe", "pipe"] : "inherit",
    shell: useShell,
  });

  // Under a shell the streams are piped only so that FIRST BYTE can be observed;
  // every byte is forwarded on untouched, so the terminal sees what it would
  // have seen anyway.
  if (useShell) {
    const mark = () => {
      started = true;
    };
    child.stdout?.on("data", (d) => {
      mark();
      process.stdout.write(d);
    });
    child.stderr?.on("data", (d) => {
      mark();
      process.stderr.write(d);
    });
  }

  child.on("error", (err) => {
    // ENOENT on the bare command means the shell cannot resolve it, which the
    // fallback answers. ENOENT on npx means node's own tooling is missing, and
    // nothing here can stand in for that.
    if (err.code === "ENOENT" && command === "vincentt") {
      console.error(
        "\n  The vincentt command was not found on PATH — running it through npx instead.\n" +
          "  A global install needs PATH set up before the bare command works.\n",
      );
      run("npx", ["@vincentt-xr/cli", ...args]);
      return;
    }
    console.error(
      err.code === "ENOENT"
        ? "\n  ✗ Neither vincentt nor npx could be run. Node.js and npm are what provide npx.\n"
        : `\n  ✗ ${err.message}\n`,
    );
    process.exit(1);
  });

  // Ctrl-C reaches the child directly (same process group), and it runs its own
  // teardown — ending the preview session and taking the address offline. Exiting
  // only once it has is what keeps a stop from being reported before it happened.
  child.on("exit", (code, signal) => {
    // Under a shell (Windows) an unresolvable command is not an ENOENT on the
    // spawn — the shell itself runs, fails to find it, and exits non-zero. So
    // the fallback has to be reachable from HERE too, or the platform where
    // PATH is most often wrong is the one platform the fallback never helps.
    if (useShell && command === "vincentt" && !signal && code !== 0 && !started) {
      console.error(
        "\n  The vincentt command could not be run — trying npx instead.\n" +
          "  A global install needs PATH set up before the bare command works.\n",
      );
      run("npx", ["@vincentt-xr/cli", ...args]);
      return;
    }
    process.exit(signal ? 1 : (code ?? 0));
  });
}

run("vincentt", args);
