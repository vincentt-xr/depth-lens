// The app's freeze handler, driven through the REAL harness `openConsoleChannel`
// from an allowed console origin. No camera, no phone, no tunnel — injected
// framing handles and a fake stream, the same seams the framed-startup suite uses.
//
// WHAT IS AND IS NOT MOCKED, because it decides what this suite can prove:
//   - `@vincentt-xr/harness` is NOT mocked. The messages below go through the real
//     parser, the real origin check and the real source check. A hand-written fake
//     channel here would assert this repo's GUESS at the harness's wire shape and
//     stay green while the two drifted.
//   - `<XRScene>` IS mocked, to a component that records the props it was handed.
//     `frameloop` is r3f's, consumed inside a real WebGL canvas jsdom cannot run;
//     the assertion is about WHAT THE APP HANDS THE SDK, which is exactly the
//     boundary the design fixed (`canvasProps`, not a bare `frameloop`).
//   - the SDK's session IS faked. Applying a source is not this suite's subject;
//     the ORDER it happens in relative to the release is.

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Shell } from "./App";

const CONSOLE_ORIGIN = "https://console.vincentt.studio";

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
    // The session object is STABLE ACROSS RENDERS, matching the real provider. A
    // fresh literal per render would change `applySource`'s identity, re-fire the
    // channel effect and re-announce — an artifact of the mock that would read as
    // the app breaking its one-message-once rule.
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
    // Records the props and mounts NO children.
    //
    // The real children are the r3f scene graph — `<ambientLight>` and friends —
    // which mean nothing to a DOM reconciler and warn on every render. Nothing
    // this suite asserts comes from inside the scene: the subject is the
    // `canvasProps` value handed ACROSS this boundary, which is recorded here.
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

// The app's own scene content is irrelevant here and pulls in three.js.
vi.mock("./Scene", () => ({ Scene: () => null }));
vi.mock("./PreviewAnchors", () => ({ PreviewAnchors: () => null }));
vi.mock("@react-three/drei", () => ({ PerspectiveCamera: () => null }));
vi.mock("./MediaSourceControl", () => ({ MediaSourceControl: () => null }));

// Applying a source is faked at the stream layer so no clip is fetched. The
// ordering log is written HERE, at the moment the app actually applies.
vi.mock("./mediaStream", () => ({
  streamFromImageUrl: vi.fn(
    async () => ({ id: "img" }) as unknown as MediaStream,
  ),
  streamFromVideoUrl: vi.fn(async () => ({
    stream: { id: "vid" } as unknown as MediaStream,
    stop: () => undefined,
  })),
}));

/** The `canvasProps` handed to the SDK on the most recent render. */
const currentCanvasProps = () =>
  sceneProps[sceneProps.length - 1]?.canvasProps as
    | { frameloop?: string }
    | undefined;

const currentFrameloop = () => currentCanvasProps()?.frameloop;

/** A recording stand-in for the parent the app posts its announce at. */
let parentPostMessage: ReturnType<typeof vi.fn>;

/**
 * Mount the app FRAMED, with the framing decided by injected window handles.
 *
 * `isFramed()` compares `window.self !== window.top` — in both the template's
 * `framed.ts` and the harness's own copy — so stubbing the two globals is the
 * shipped seam for both at once.
 */
async function mountFramed() {
  parentPostMessage = vi.fn();
  const fakeParent = { postMessage: parentPostMessage };
  vi.stubGlobal("self", globalThis.window);
  vi.stubGlobal("top", { name: "embedder" });
  vi.stubGlobal("parent", fakeParent);

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
    .map((call) => call[0] as { type?: string; capabilities?: unknown })
    .find((message) => message?.type === "announce");

beforeEach(() => {
  sceneProps.length = 0;
  events = [];
  setMediaSource.mockReset();
  // The ordering probe: what the scene was being told to do AT THE MOMENT the
  // source was applied. A build that applies first and clears after is caught
  // here and nowhere else — its end state is identical to a correct build's.
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

describe("QA-F13-G45 · the app holds and releases through canvasProps.frameloop", () => {
  it("holds: `set-render-hold {held:true}` sets canvasProps.frameloop to 'never'", async () => {
    await mountFramed();
    expect(currentFrameloop()).toBe("always");

    await deliver(holdCommand(true));

    expect(currentFrameloop()).toBe("never");
  });

  it("releases: `{held:false}` sets it back to 'always'", async () => {
    await mountFramed();
    await deliver(holdCommand(true));
    expect(currentFrameloop()).toBe("never");

    await deliver(holdCommand(false));

    expect(currentFrameloop()).toBe("always");
  });

  it("the freeze travels in `canvasProps`, NEVER as a bare `frameloop` prop", async () => {
    // The correction that closed FORK-QT2. `<XRScene>` owns the `<Canvas>`; a bare
    // `frameloop` is an unknown prop there and would be silently dropped — the app
    // would look correct in review and never freeze. Asserting the container as
    // well as the value is what keeps a "fix" that moves it up a level from passing.
    await mountFramed();
    await deliver(holdCommand(true));

    const props = sceneProps[sceneProps.length - 1];
    expect(
      props.frameloop,
      "frameloop must not be passed bare to XRScene",
    ).toBeUndefined();
    expect((props.canvasProps as { frameloop?: string }).frameloop).toBe(
      "never",
    );
  });

  it("R2 · without the command the frameloop is 'always' and the source is unchanged", async () => {
    await mountFramed();

    expect(currentFrameloop()).toBe("always");
    // The startup binder's own call is the only one; no console command landed.
    expect(
      setMediaSource.mock.calls.length,
      "no console command was sent, so nothing beyond startup may have applied",
    ).toBeLessThanOrEqual(1);
  });
});

describe("QA-F13-G45 · a media command releases the hold, BEFORE applying", () => {
  it("clears the hold and only THEN applies the source — the ordering, not the end state", async () => {
    await mountFramed();
    await deliver(holdCommand(true));
    expect(currentFrameloop()).toBe("never");

    // The preset id is read from the app's OWN announce rather than hand-written,
    // so this cannot drift from the SDK's real preset list.
    const announced = announce() as { presets?: { id: string }[] };
    const presetId = announced.presets?.[0]?.id;
    expect(
      presetId,
      "the app must announce at least one preset to command",
    ).toBeTruthy();

    events.length = 0;
    setMediaSource.mockClear();

    await deliver(mediaCommand(presetId!));

    // The end state alone is satisfied by a build that applies and THEN clears,
    // which leaves one frame painted behind the freeze. The order is the assertion:
    // the scene must already be released at the instant the source lands.
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    expect(
      events,
      "the hold must be cleared BEFORE the source is applied, not after",
    ).toEqual(["source-applied@frameloop=always"]);
    expect(currentFrameloop()).toBe("always");
  });
});

describe("QA-F13-G45 · the announce declares the capability, and the app says nothing else", () => {
  it("carries `render-hold` because the handler is wired", async () => {
    await mountFramed();

    expect(announce()?.capabilities).toEqual(["render-hold", "frame-still"]);
  });

  it("the app sends NOTHING back on any path — announce excepted, once", async () => {
    // B-F13-3: exactly one message, once, on mount. No ack for the hold, no ack
    // for the release, no report of the swap. The recording spy is what proves it;
    // an absent error could never have.
    await mountFramed();
    // The baseline is the announce fan-out, not 1: the harness posts the SAME
    // announce once per allowed console origin, and only the real parent's origin
    // delivers. What must not grow is the number of posts after commands arrive.
    //
    // `experience:status` is NOT channel traffic and is excluded: it is the
    // shell's public readiness signal to any embedder (#117), posted on mount and
    // on a readiness change, never in answer to a console command.
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
    const announced = announce() as { presets?: { id: string }[] };
    await deliver(mediaCommand(announced.presets![0].id));
    // A command from a WRONG origin, and a malformed one, must also stay silent.
    await deliver(holdCommand(true), "https://evil.example");
    await deliver({
      source: "vincentt-console",
      v: 1,
      type: "set-render-hold",
      held: "yes",
    });

    expect(
      channelPosts().length,
      "the app must never post anything on the channel beyond its single announce",
    ).toBe(afterAnnounce);
  });

  it("a hold from a DISALLOWED origin does not freeze the app", async () => {
    await mountFramed();

    await deliver(holdCommand(true), "https://evil.example");

    expect(currentFrameloop()).toBe("always");
  });
});
