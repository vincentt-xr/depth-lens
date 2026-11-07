// 4C-template · QA-F13-G11 (superseded) and QA-F13-G14 (retired), from
// features/changes/console-owns-frame-chrome/qa.md.
//
// ── [retire QA-F13-G14] · THE WEBCAM FILTER IS GONE, AND SO IS ITS CASE ───────
//
// G14 asserted that the framed switcher filtered the webcam entry out of its
// source list, leaving a dead Camera tab whose reachable behavior it then pinned.
// ITS SUBJECT NO LONGER EXISTS. The frame now delegates camera
// (`D-The-frame-delegates-camera-and-the-no-grant-property-is-spent`), so the
// filter was WRONG rather than merely unnecessary and was removed with it —
// `switcherSources` is deleted from `framed.ts`. There is no framed switcher, no
// filtered list and no dead tab left to assert, and
// `D-The-webcam-filter-leaves-a-dead-tab` is RESOLVED rather than documented.
//
// The old G14 block is not rewritten into something else. A retired case whose
// tests are repurposed keeps a green tick alive for a behavior nobody decided;
// the honest record is the reason above plus the absence assertion below, which
// is what stops the filter quietly returning.
//
// ── [supersede QA-F13-G11] · THE FRAMED APP RENDERS ONLY THE APP ──────────────
//
// f13's G11 pinned the framed SWITCHER's behavior (which preset it defaulted to,
// that it never chose the webcam). 2A.C6 removes the mount entirely, so the
// subject moved: what must now be true is that NOTHING of the app's own chrome
// mounts when framed, and that all of it still mounts when not.
//
// R5 — BOTH ARMS IN ONE SUITE. The framed arm alone is satisfied perfectly by a
// build that deleted the controls outright, which would break every creator's
// local `vincentt preview` loop. "Gated, not deleted" is a claim about TWO
// states, so the unframed arm is not a nicety here; it IS the case.
//
// The harness's half of this (the Share overlay's NEW framed gate, the feedback
// chip, the annotation module's dynamic import) is asserted in
// toolchain/packages/harness/src/client/qa_f13_g11_framed_mounts.test.ts. This
// file owns the TEMPLATE's half: the in-app media control.
//
// Superseded again by gallery-live-webcam: a framed app on its webcam default
// starts on the webcam when its own address carries `source=webcam`. The full
// search matrix and the no-fallback arm run through the real binder in
// mediaSourceBinder.test.tsx; requestsWebcam's fail-closed arms in framed.test.ts.

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MediaSourceControl } from "./MediaSourceControl";
import { chooseMediaSource, isFramed, pickFramedDefault } from "./framed";

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // A REJECTING spy, not a resolving one. A resolving stub would let a build that
  // called getUserMedia sail past — the assertion is that it is NEVER CALLED on the
  // framed startup path, and the spy is what proves it rather than the absence of a
  // visible error.
  getUserMedia = vi.fn().mockRejectedValue(new Error("getUserMedia must not be called"));
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Render the app's media control with the framing decided by INJECTED window
 * handles rather than by a real frame.
 *
 * `isFramed()` reads `window.self !== window.top`, so the two are stubbed. This is
 * the shipped seam — no real iframe, no camera, no phone, no tunnel — and it is why
 * this whole case is runnable locally with no prerequisite.
 */
function renderControl({ framed, enabled = true }: { framed: boolean; enabled?: boolean }) {
  const top = framed ? {} : globalThis.window;
  vi.stubGlobal("self", globalThis.window);
  vi.stubGlobal("top", top);
  return render(
    <MediaSourceControl
      value={{ id: "p1", kind: "video", label: "A clip" }}
      onChange={vi.fn()}
      enabled={enabled}
    />,
  );
}

// ---------------------------------------------------------------------------
// QA-F13-G11 · the framed app renders ONLY the app — both directions pinned
// ---------------------------------------------------------------------------

describe("QA-F13-G11 · the template's media control, framed and unframed", () => {
  it("FRAMED · the media-source control mounts NO NODE", async () => {
    // Absence of a node, never a hidden or disabled one. A present-but-dead control
    // is the failure mode this whole surface forbids: the console draws the source
    // control in its own chrome beside the frame, and a second one inside the frame
    // gives the creator two switchers in one workspace.
    const { container } = renderControl({ framed: true });
    // Waited, not sampled: the mount is behind a dynamic import, so an immediate
    // assertion would pass against a build whose import simply had not resolved yet.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(container.innerHTML).toBe("");
    expect(container.querySelector("[hidden]")).toBeNull();
    expect(container.querySelector("[disabled]")).toBeNull();
  });

  it("UNFRAMED · the control DOES mount — the arm that makes the framed one mean something", async () => {
    // R5's positive twin. Without this, a build that deleted the control outright
    // passes the framed assertion perfectly while breaking every creator's local
    // `vincentt preview` loop, which has no console chrome to take over.
    //
    // ── READ document.body, NOT RTL's CONTAINER ────────────────────────────────
    //
    // The SDK's switcher renders through a PORTAL into document.body, so RTL's
    // container stays empty even on a fully correct mount. An assertion on the
    // container fails a correct build — and, far worse, it fails for the same reason
    // a DELETED control would, so it could never have told the two apart. The framed
    // arm above reads the container legitimately (nothing mounts anywhere), but the
    // positive arm has to look where the node actually lands.
    renderControl({ framed: false });
    await vi.waitFor(
      () => {
        expect(
          document.body.innerHTML,
          "the unframed app keeps its own in-app switcher; the framed gate must be a " +
            "NARROWING, never a deletion",
        ).toContain("pointer-events");
      },
      { timeout: 5000 },
    );
  });

  it("FRAMED · nothing mounts into document.body either — the portal is not a loophole", async () => {
    // The framed assertion, repeated against the node the portal actually uses. A
    // gate that stopped the in-container render but left the portal would pass the
    // first framed case and still put a second switcher inside the frame.
    renderControl({ framed: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(document.body.innerHTML).not.toContain("pointer-events");
  });

  it("FRAMED · no getUserMedia is reached on the startup path", () => {
    // A SPY, not an absence-of-error. The framed default resolves to a preset clip
    // rather than raising a permission prompt nobody asked for.
    renderControl({ framed: true });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("the framing check reads a FACT ABOUT ITSELF, with no sender and no channel", () => {
    // No sender, no message, no postMessage listener. Deliberately true inside
    // ANY frame: the reason a control is withheld holds for any embedder, not just
    // ours. This survives G11's supersession unchanged.
    expect(isFramed({ self: {}, top: {} })).toBe(true);
    const same = {};
    expect(isFramed({ self: same, top: same })).toBe(false);
  });

  it("an unknown or throwing context folds to NOT framed", () => {
    // Fail toward today's shipped behavior. Folding the other way would silently
    // withhold a control on the creator's own machine.
    const hostile = {
      get self() {
        return {};
      },
      get top(): unknown {
        throw new Error("cross-origin");
      },
    };
    expect(isFramed(hostile as never)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// QA-F13-G11 · a CONFIGURED source survives framing (regression pin)
// ---------------------------------------------------------------------------

describe("QA-F13-G11 · a creator's configured source is never overridden", () => {
  // The 2x2 is the case. A build that simply never chose the webcam would pass a
  // framed-only test and break the local dev loop.
  it("framed + default → a preset, never the webcam", () => {
    expect(chooseMediaSource({}, true)).toEqual({ kind: "framedPreset" });
  });

  it("framed + configured → the CREATOR'S source, unchanged", () => {
    // Overriding a deliberate config pointed at client footage would hide work they
    // did. Framed or not, a configured source wins.
    expect(chooseMediaSource({ VITE_INPUT_SOURCE: "video", VITE_INPUT_URL: "u" }, true)).toEqual({
      kind: "video",
      url: "u",
    });
    expect(chooseMediaSource({ VITE_INPUT_SOURCE: "photo", VITE_INPUT_URL: "p" }, true)).toEqual({
      kind: "photo",
      url: "p",
    });
  });

  it("unframed + default → the WEBCAM, byte-identical to today (a REGRESSION PIN)", () => {
    expect(chooseMediaSource({}, false)).toEqual({ kind: "webcam" });
  });

  it("framed + default + source=webcam → the webcam (gallery-live-webcam)", () => {
    expect(chooseMediaSource({}, true, true)).toEqual({ kind: "webcam" });
  });

  it("framed + configured + source=webcam → the CREATOR'S source still wins", () => {
    expect(
      chooseMediaSource({ VITE_INPUT_SOURCE: "video", VITE_INPUT_URL: "u" }, true, true),
    ).toEqual({ kind: "video", url: "u" });
    expect(
      chooseMediaSource({ VITE_INPUT_SOURCE: "photo", VITE_INPUT_URL: "p" }, true, true),
    ).toEqual({ kind: "photo", url: "p" });
  });

  it("unframed + configured → unchanged", () => {
    expect(chooseMediaSource({ VITE_INPUT_SOURCE: "video" }, false)).toEqual({
      kind: "video",
      url: undefined,
    });
  });

  it("the framed default resolves to a VIDEO preset, picked by kind rather than index", () => {
    // A MOVING clip rather than a still, so the creator sees the tracker RESPOND
    // rather than a frozen detection. Picking by `kind` means a list reordered
    // upstream still yields a video.
    const picked = pickFramedDefault([
      { kind: "image", id: "i" },
      { kind: "video", id: "v" },
    ]);
    expect(picked?.kind).toBe("video");
  });
});

// ---------------------------------------------------------------------------
// [retire QA-F13-G14] · the filter is gone, and stays gone
// ---------------------------------------------------------------------------

describe("QA-F13-G14 (RETIRED) · the webcam filter no longer exists", () => {
  it("`switcherSources` is absent from framed.ts, filter and all", () => {
    // The one assertion the retirement keeps. G14's subject was removed by a
    // DECISION, so the honest guard is that the removal holds — not a rewritten case
    // asserting some neighbouring behavior to keep a tick alive.
    //
    // Read from source rather than imported: importing a deleted export is a
    // TYPECHECK error, which fails the build rather than this case, and would say
    // nothing about a filter reintroduced under another name.
    const src = readFileSync(join(process.cwd(), "src/framed.ts"), "utf8");
    expect(
      src,
      "the webcam filter existed only because no camera grant crossed the frame " +
        "boundary. The frame now delegates camera, so a filter here would remove an " +
        "entry the creator can actually use.",
    ).not.toMatch(/switcherSources/);
    expect(src, "no kind-based webcam exclusion may return under another name").not.toMatch(
      /filter\([^)]*!==\s*["']webcam["']/,
    );
  });

  it("POSITIVE CONTROL · framed.ts is the file that WOULD carry it", () => {
    // Without this, the absence above passes against a moved or renamed file.
    const src = readFileSync(join(process.cwd(), "src/framed.ts"), "utf8");
    expect(src).toMatch(/export const chooseMediaSource/);
    expect(src).toMatch(/export const announcedPresets/);
  });
});
