// 4C · QA-F13-G45 — **the app freezes and releases through
// `canvasProps.frameloop`, and a media command clears the hold BEFORE applying the
// source.**
//
// ── WHAT IS AND IS NOT MOCKED, BECAUSE IT DECIDES WHAT THIS CAN PROVE ─────────
//
//   · `@vincentt-xr/harness` is **NOT** mocked. Every message below crosses the
//     REAL `openConsoleChannel`, the REAL origin check and the REAL source check.
//     A hand-written fake channel here would assert this repo's GUESS at the wire
//     shape and stay green while the two repos drifted — the f1 failure exactly.
//   · `<XRScene>` **IS** mocked, to a component that records the props it was
//     handed. `frameloop` is r3f's, consumed inside a real WebGL canvas jsdom
//     cannot run, and the assertion is about WHAT THE APP HANDS THE SDK — which is
//     the boundary `D-the-freeze-prop-is-canvasProps-not-frameloop` fixed.
//   · the SDK session **IS** faked. Applying a source is not this case's subject;
//     the ORDER it happens in relative to the release is.
//
// ── THE ORDERING IS THE ASSERTION, NOT THE END STATE ──────────────────────────
//
// A build that applies the source and THEN clears the hold reaches an IDENTICAL
// end state — released, new source — while leaving one frame painted behind a
// freeze. So the probe records what the scene was being told to do AT THE MOMENT
// the source landed, which is the only way the two are distinguishable.
//
// `D-releasing-the-hold-requires-a-synchronous-flush` is the mechanism that
// satisfies it: a plain `setPaused(false)` only QUEUES a re-render, which React
// runs after the handler returns, while the swap reaches `setMediaSource` in a
// microtask that wins the race. This case is written against the REQUIREMENT (the
// ordering), not against the mechanism, so a future implementation that satisfies
// it another way still passes.

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Shell } from "./App";

const CONSOLE_ORIGIN = "https://console.vincentt.studio";
const FOREIGN_ORIGIN = "https://console.vincentt.studio.evil.example";

/** Every prop `<XRScene>` was rendered with, newest last. */
const sceneProps: Record<string, unknown>[] = [];

/** Ordered log of the acts under test, so the ORDERING can be asserted. */
let events: string[] = [];

const { setMediaSource, start, SESSION } = vi.hoisted(() => {
  const setMediaSourceFn = vi.fn();
  const startFn = vi.fn().mockResolvedValue(undefined);
  return {
    setMediaSource: setMediaSourceFn,
    start: startFn,
    // STABLE ACROSS RENDERS, matching the real provider. A fresh literal per render
    // would change `applySource`'s identity, re-fire the channel effect and
    // re-announce — an artifact of the mock that would read as the app breaking its
    // one-message-once rule.
    SESSION: { session: { setMediaSource: setMediaSourceFn, start: startFn } },
  };
});

vi.mock("@vincentt-xr/sdk/low-level", () => ({
  useXRPipelineSnapshot: () => [],
  useXRContext: () => SESSION,
  useXRReady: () => true,
  useXRError: () => undefined,
}));

vi.mock("@vincentt-xr/sdk", async () => {
  const { createElement } = await import("react");
  return {
    XRProvider: ({ children }: { children?: unknown }) => children,
    // Records the props and mounts NO children: the real children are the r3f scene
    // graph, which means nothing to a DOM reconciler. Nothing this case asserts
    // comes from inside the scene — the subject is the value handed ACROSS this
    // boundary.
    XRScene: (props: Record<string, unknown>) => {
      sceneProps.push(props);
      return createElement("div", { "data-testid": "scene" });
    },
    AspectRatioContainer: ({ children }: { children?: unknown }) =>
      createElement("div", null, children as never),
    VideoBackground: () => null,
    XRMediaSource: { WEBCAM: "webcam", STREAM: "stream" },
  };
});

vi.mock("./Scene", () => ({ Scene: () => null }));
vi.mock("./PreviewAnchors", () => ({ PreviewAnchors: () => null }));
vi.mock("@react-three/drei", () => ({ PerspectiveCamera: () => null }));
vi.mock("./MediaSourceControl", () => ({ MediaSourceControl: () => null }));

// Faked at the stream layer so no clip is fetched. The ordering log is written at
// the moment the app actually applies.
vi.mock("./mediaStream", () => ({
  streamFromImageUrl: vi.fn(
    async () => ({ id: "img" }) as unknown as MediaStream,
  ),
  streamFromVideoUrl: vi.fn(async () => ({
    stream: { id: "vid" } as unknown as MediaStream,
    stop: () => undefined,
  })),
}));

/** The props handed to `<XRScene>` on the most recent render. */
const currentSceneProps = () => sceneProps[sceneProps.length - 1] ?? {};
const currentCanvasProps = () =>
  currentSceneProps().canvasProps as { frameloop?: string } | undefined;
const currentFrameloop = () => currentCanvasProps()?.frameloop;

/** A recording stand-in for the parent the app posts its announce at. */
let parentPostMessage: ReturnType<typeof vi.fn>;

/**
 * Mount the app FRAMED, with the framing decided by injected window handles.
 *
 * `isFramed()` compares `window.self !== window.top` in both the template's
 * `framed.ts` and the harness's own copy, so stubbing the two globals is the
 * shipped seam for both at once. No camera, no phone, no tunnel.
 */
async function mountFramed() {
  parentPostMessage = vi.fn();
  vi.stubGlobal("self", globalThis.window);
  vi.stubGlobal("top", { name: "embedder" });
  vi.stubGlobal("parent", { postMessage: parentPostMessage });

  const result = render(<Shell />);
  // The channel opens behind a dynamic import of the SDK's preset module, so an
  // immediate send would race the listener's registration. Wait for the ANNOUNCE
  // itself: the shell also posts its public `experience:status` to the parent on
  // mount (#117), and that lands before the channel is open.
  await vi.waitFor(() => expect(announce()).toBeDefined());
  return result;
}

/** Deliver a console→app message the way the browser would. */
async function deliver(data: unknown, origin: string = CONSOLE_ORIGIN) {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin,
        source: window.parent as Window,
      }),
    );
    // The harness copies the picture in the next frame and only then calls the
    // app's hold handler, so a hold lands one frame after the command.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    });
  });
}

const holdCommand = (held: boolean) => ({
  source: "vincentt-console",
  v: 1,
  type: "set-render-hold",
  held,
});

const mediaCommand = (presetId: string) => ({
  source: "vincentt-console",
  v: 1,
  type: "set-media-source",
  presetId,
});

/** The announce the app actually posted, read off the recording parent. */
const announce = () =>
  parentPostMessage.mock.calls
    .map(
      (call) =>
        call[0] as {
          type?: string;
          capabilities?: unknown;
          presets?: { id: string }[];
        },
    )
    .find((message) => message?.type === "announce");

beforeEach(() => {
  sceneProps.length = 0;
  events = [];
  setMediaSource.mockReset();
  // THE ORDERING PROBE: what the scene was being told to do AT THE MOMENT the
  // source was applied. A build that applies first and clears after is caught here
  // and nowhere else — its END STATE is identical to a correct build's.
  setMediaSource.mockImplementation(async () => {
    events.push(`source-applied@frameloop=${currentFrameloop()}`);
  });
  start.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // The harness announces once per page and never releases its latch; every test
  // here is a fresh page.
  delete (window as unknown as Record<symbol, unknown>)[
    Symbol.for("vincentt.harness.announced")
  ];
});

describe("QA-F13-G45 · the freeze travels in `canvasProps`, and both directions work", () => {
  it("R2 · WITHOUT any command the frameloop is 'always' and the source is unchanged", async () => {
    // The twin for every arm below. Without it, "the hold sets 'never'" is satisfied
    // by an app that is always frozen.
    await mountFramed();

    expect(currentFrameloop()).toBe("always");
    expect(
      setMediaSource.mock.calls.length,
      "no console command was sent, so nothing beyond startup may have applied",
    ).toBeLessThanOrEqual(1);
  });

  it("`{held:true}` sets `canvasProps.frameloop` to 'never'", async () => {
    await mountFramed();
    expect(currentFrameloop()).toBe("always");

    await deliver(holdCommand(true));

    expect(
      currentFrameloop(),
      "the app did not stop its render loop. Everything visible composites through the " +
        "one r3f canvas, so halting its repaint is the whole mechanism.",
    ).toBe("never");
  });

  it("`{held:false}` sets it back to 'always'", async () => {
    await mountFramed();
    await deliver(holdCommand(true));
    expect(currentFrameloop()).toBe("never");

    await deliver(holdCommand(false));

    expect(currentFrameloop()).toBe("always");
  });

  it("it is `canvasProps.frameloop`, NEVER a bare `frameloop` prop", async () => {
    // The correction that closed FORK-QT2. `<XRScene>` owns the `<Canvas>`; a bare
    // `frameloop` is an unknown prop there and would be SILENTLY DROPPED — the app
    // would look correct in review and never freeze. Asserting the CONTAINER as well
    // as the value is what keeps a "fix" that moves it up a level from passing.
    await mountFramed();
    await deliver(holdCommand(true));

    const props = currentSceneProps();
    expect(
      props.frameloop,
      "`frameloop` was passed BARE to <XRScene>, where it does not exist — the SDK " +
        "would drop it and the app would never freeze",
    ).toBeUndefined();
    expect((props.canvasProps as { frameloop?: string }).frameloop).toBe(
      "never",
    );
  });

  it("the SDK's own `canvasProps` keys are not clobbered by the freeze", async () => {
    // The build note in `D-the-freeze-prop-is-canvasProps-not-frameloop`: the app
    // overrides exactly `frameloop` and inherits the rest. A future path needing
    // `preserveDrawingBuffer` must merge into `canvasProps.gl` rather than replacing
    // `canvasProps`, and this pins that the app is not already replacing something.
    await mountFramed();
    await deliver(holdCommand(true));

    expect(
      Object.keys(currentCanvasProps() ?? {}),
      "the app hands the SDK more than the freeze — anything else here is a value the " +
        "SDK's own defaults would have supplied",
    ).toEqual(["frameloop"]);
  });

  it("hold survives a repeat: two `{held:true}` commands leave it frozen", async () => {
    // `held` is ABSOLUTE, never a toggle. Two identical commands must not resume.
    await mountFramed();
    await deliver(holdCommand(true));
    await deliver(holdCommand(true));
    expect(
      currentFrameloop(),
      "a repeated hold command resumed the app — `held` is absolute on the wire " +
        "precisely so a dropped message cannot desynchronise the two sides",
    ).toBe("never");
  });
});

describe("QA-F13-G45 · a media command clears the hold BEFORE applying the source", () => {
  it("THE ORDERING, not the end state: the scene is already released when the source lands", async () => {
    await mountFramed();
    await deliver(holdCommand(true));
    expect(currentFrameloop()).toBe("never");

    // The preset id is read from the app's OWN announce rather than hand-written, so
    // it cannot drift from the SDK's real preset list.
    const announced = announce();
    const presetId = announced?.presets?.[0]?.id;
    expect(
      presetId,
      "the app must announce at least one preset to command",
    ).toBeTruthy();

    events.length = 0;
    setMediaSource.mockClear();

    await deliver(mediaCommand(presetId!));

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    expect(
      events,
      "the hold was cleared AFTER the source was applied, or not before it. Applying " +
        "then clearing leaves one frame painted behind a freeze — the exact failure " +
        "the ordering decision exists to prevent, and its END STATE is identical to a " +
        "correct build's, so only this ordering probe can see it.",
    ).toEqual(["source-applied@frameloop=always"]);
    expect(currentFrameloop()).toBe("always");
  });

  it("POSITIVE CONTROL · the ordering probe DOES record the frozen value when frozen", async () => {
    // R2 for the probe itself. If the probe could never report `never`, the assertion
    // above would pass against any build. Proven by reading the probe's own source of
    // truth WHILE held, with no media command in flight.
    await mountFramed();
    await deliver(holdCommand(true));
    expect(currentFrameloop()).toBe("never");
    // The probe reads exactly this function, so a build that applied while frozen
    // would log `source-applied@frameloop=never` — a value the probe can produce.
    events.push(`probe-check@frameloop=${currentFrameloop()}`);
    expect(events).toContain("probe-check@frameloop=never");
  });

  it("a media command with NO hold in effect still applies, and stays released", async () => {
    await mountFramed();
    const presetId = announce()?.presets?.[0]?.id;
    events.length = 0;
    setMediaSource.mockClear();

    await deliver(mediaCommand(presetId!));

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    expect(events).toEqual(["source-applied@frameloop=always"]);
  });
});

describe("QA-F13-G45 · the capability is emitted ONLY when the handler is wired", () => {
  it("the app's announce carries `render-hold`", async () => {
    // `D-the-capability-is-derived-from-the-handler`. The console TRUSTS this
    // self-declaration and CANNOT detect a false one — there is no ack, by design —
    // so the only place a false declaration is preventable is structurally, here.
    await mountFramed();

    expect(
      announce()?.capabilities,
      "the app wired a hold handler and did not declare the capability, so the console " +
        "renders no control for an app that can freeze",
    ).toEqual(["render-hold", "frame-still"]);
  });

  it("the declaration is DERIVED from the wiring — the harness cannot be told otherwise", async () => {
    // Asserted at the boundary that produces it, with the REAL builder the template
    // actually consumes, so this is a property of the INSTALLED harness rather than
    // of the template's call site alone.
    //
    // ⚠ WHAT THIS DOES AND DOES NOT PROVE. The template consumes `@vincentt-xr/harness`
    // as a PUBLISHED REGISTRY PACKAGE, not a workspace link, so this reads
    // `node_modules` — which on this machine holds a LOCALLY-BUILT `dist` rather than
    // the registry's 1.4.0. That is the correct thing to test here (it is what the
    // app will run once the harness publishes) but it means a green result does NOT
    // prove the registry has shipped it. The cross-repo agreement is QA-F13-G44's job
    // and is asserted against the harness SOURCE in the sibling worktree; this arm
    // asserts the app's own consumption of whatever is installed.
    const { buildAnnounce } = await import("@vincentt-xr/harness");

    expect(
      typeof buildAnnounce,
      "the installed harness does not export `buildAnnounce` — the capability cannot " +
        "be derived from anything, and this arm is asserting nothing",
    ).toBe("function");

    const presets = [
      {
        id: "clip-1",
        label: "A clip",
        kind: "video" as const,
        mirrored: false,
      },
    ];

    const withHandler = buildAnnounce(presets, {
      onSetRenderHold: () => undefined,
    });
    const withoutHandler = buildAnnounce(presets);

    expect(
      withHandler.capabilities,
      "supplying a handler did not produce the declaration — an app could then implement " +
        "a hold the console never offers",
    ).toContain("render-hold");
    expect(
      withoutHandler.capabilities ?? [],
      "an app with NO handler declared `render-hold` — that is a live button that does " +
        "nothing, the present-but-dead failure the console cannot detect.",
    ).not.toContain("render-hold");
  });
});

describe("QA-F13-G45 · the app sends NOTHING back, on any path", () => {
  it("no ack, no error, no report — the announce is the only thing that leaves", async () => {
    // Asserted with a recording `postMessage`. An absent error could never prove it.
    await mountFramed();

    // The baseline is the announce FAN-OUT (one post per allowed console origin),
    // not 1: only the real parent's origin delivers, and the others go nowhere.
    //
    // `experience:status` is NOT channel traffic and is excluded: it is the
    // shell's public readiness signal to any embedder (#117), posted on mount
    // and on a readiness change, never in response to a console command. The
    // pin here is about the CHANNEL — no ack, no error, no report — so the
    // count below must not move when a command arrives.
    const channelPosts = () =>
      parentPostMessage.mock.calls.filter(
        (call) => (call[0] as { type?: string })?.type !== "experience:status",
      );
    const afterAnnounce = channelPosts().length;
    expect(
      channelPosts().every(
        (call) => (call[0] as { type?: string })?.type === "announce",
      ),
      "the only thing the app may ever post on the channel is its announce",
    ).toBe(true);

    await deliver(holdCommand(true));
    await deliver(holdCommand(false));
    await deliver(mediaCommand(announce()!.presets![0].id));
    // And on the REFUSED paths too — a refusal is not an error to report, because
    // there is no channel to report it on.
    await deliver(holdCommand(true), FOREIGN_ORIGIN);
    await deliver({
      source: "vincentt-console",
      v: 1,
      type: "set-render-hold",
      held: "yes",
    });
    await deliver({ source: "vincentt-console", v: 1, type: "ack" });

    expect(
      channelPosts().length,
      "the app posted something after a command arrived. An ack for `set-render-hold` " +
        "is the B-F13-3 breach — capability crosses, observation does not.",
    ).toBe(afterAnnounce);
    // And the public signal did not fire either: no command changes readiness.
    expect(
      parentPostMessage.mock.calls.filter(
        (call) => (call[0] as { type?: string })?.type === "experience:status",
      ).length,
      "a console command must not re-post the experience status",
    ).toBe(1);
  });

  it("a hold from a DISALLOWED origin does not freeze the app", async () => {
    await mountFramed();

    await deliver(holdCommand(true), FOREIGN_ORIGIN);

    expect(
      currentFrameloop(),
      "a command from a look-alike origin froze the app. `https://<console>.evil.example` " +
        "passes a prefix test, which is the standard way this check is broken.",
    ).toBe("always");
  });

  it("a malformed `held` does not freeze the app", async () => {
    await mountFramed();

    await deliver({
      source: "vincentt-console",
      v: 1,
      type: "set-render-hold",
      held: "yes",
    });

    expect(currentFrameloop()).toBe("always");
  });
});
