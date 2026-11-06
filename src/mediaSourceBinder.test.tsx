// The framed startup path, driven through the REAL MediaSourceBinder against a
// fake stream. No camera, no phone, no tunnel.
//
// The load-bearing assertion is a NEGATIVE one: `getUserMedia` is never called
// when framed. That is what makes the frame's absent `allow` attribute cost
// nothing — with no camera request on the startup path there is no permission to
// be denied, so the whole-scene camera error is unreachable AT STARTUP. (It is
// NOT unreachable once the switcher is mounted; that door is closed separately,
// by filtering the webcam entries out of the switcher's list.)

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The SDK's real media-source module is used as-is: the preset URL asserted
// below is READ FROM IT, never hand-written, so this cannot drift from the SDK.
import { sdkVideoMediaSources } from "@vincentt-xr/sdk/debug-ui/media-source";
import * as framed from "./framed";

// The pure chooser is spied THROUGH so the wiring can be asserted: the binder
// must hand it the scene's registered trackers, read after its own mount.
vi.mock("./framed", async (importOriginal) => {
  const real = await importOriginal<typeof import("./framed")>();
  return { ...real, pickFramedDefault: vi.fn(real.pickFramedDefault) };
});

import { MediaSourceBinder } from "./App";

const { setMediaSource, start } = vi.hoisted(() => ({
  setMediaSource: vi.fn().mockResolvedValue(undefined),
  start: vi.fn().mockResolvedValue(undefined),
}));

// The trackers the scene has registered, as the binder reads them after one
// macrotask; a test sets it before rendering.
let registeredModels: string[] = [];

vi.mock("@vincentt-xr/sdk/low-level", () => ({
  useXRPipelineSnapshot: () => registeredModels,
  useXRContext: () => ({ session: { setMediaSource, start } }),
  useXRReady: () => false,
  useXRError: () => undefined,
}));

let getUserMedia: ReturnType<typeof vi.fn>;
let videoSrc: string | undefined;
let ctx2d: {
  save: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};

const FAKE_STREAM = {
  id: "fake-stream",
  getTracks: () => [],
} as unknown as MediaStream;

beforeEach(() => {
  setMediaSource.mockClear();
  start.mockClear();
  videoSrc = undefined;

  getUserMedia = vi
    .fn()
    .mockRejectedValue(new Error("getUserMedia must not be called"));
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });

  // jsdom implements neither video playback nor captureStream, so both are
  // faked. Nothing else about the binder is stubbed.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    async function play(this: HTMLMediaElement) {
      videoSrc = (this as HTMLVideoElement).src;
    },
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
    configurable: true,
    writable: true,
    value: () => FAKE_STREAM,
  });
  ctx2d = { save: vi.fn(), scale: vi.fn(), drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    ...ctx2d,
    restore: vi.fn(),
  } as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Put the document inside a frame, the way the console embeds it. */
const frameIt = () => {
  vi.spyOn(window, "top", "get").mockReturnValue({
    name: "embedder",
  } as unknown as Window);
};

describe("MediaSourceBinder · framed startup", () => {
  it("framed with no configured source: sets a STREAM and never calls getUserMedia", async () => {
    frameIt();
    render(<MediaSourceBinder />);

    await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
    expect(setMediaSource).toHaveBeenCalledWith(
      expect.objectContaining({ source: "stream", stream: FAKE_STREAM }),
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("framed: the stream is built from a real SDK VIDEO preset — a moving clip, not a still", async () => {
    frameIt();
    render(<MediaSourceBinder />);

    await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
    expect(sdkVideoMediaSources.map((p) => p.url)).toContain(videoSrc);
  });

  it("framed: the scene's registered trackers reach the chooser, so a hand scene can get a hand clip", async () => {
    frameIt();
    registeredModels = ["vincentt.xr.hand-tracker"];
    try {
      render(<MediaSourceBinder />);
      await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
      expect(framed.pickFramedDefault).toHaveBeenCalledWith(
        sdkVideoMediaSources,
        ["vincentt.xr.hand-tracker"],
      );
      // The installed SDK's presets carry no tags yet, so the first clip plays;
      // with tagged presets `pickFramedDefault` picks the hand clip (framed.test).
      expect(sdkVideoMediaSources.map((p) => p.url)).toContain(videoSrc);
    } finally {
      registeredModels = [];
    }
  });

  it("framed: the selected preset is handed back, so the controlled switcher shows it", async () => {
    frameIt();
    const onSourceSelected = vi.fn();
    render(<MediaSourceBinder onSourceSelected={onSourceSelected} />);

    await waitFor(() => expect(onSourceSelected).toHaveBeenCalled());
    const preset = onSourceSelected.mock.calls[0][0];
    expect(preset.kind).toBe("video");
    expect(preset.kind).not.toBe("webcam");
  });

  it("framed: the session never carries a permission error, because none is ever requested", async () => {
    frameIt();
    render(<MediaSourceBinder />);

    await waitFor(() => expect(start).toHaveBeenCalled());
    // The only producer of a PermissionError on this path is getUserMedia.
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(setMediaSource).not.toHaveBeenCalledWith(
      expect.objectContaining({ source: "webcam" }),
    );
  });
});

describe("MediaSourceBinder · a configured source is never overridden", () => {
  const CONFIGURED = "https://example.test/client-footage.mp4";

  it("framed + configured video: the creator's URL plays, not the preset", async () => {
    // Overriding a deliberate config pointed at client footage would hide work
    // the creator did, so the framing check does not reach this branch.
    frameIt();
    render(
      <MediaSourceBinder
        env={{ VITE_INPUT_SOURCE: "video", VITE_INPUT_URL: CONFIGURED }}
      />,
    );

    await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
    expect(videoSrc).toBe(CONFIGURED);
    expect(sdkVideoMediaSources.map((p) => p.url)).not.toContain(videoSrc);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("framed + configured video: the switcher shows the CONFIGURED input, not an SDK preset", async () => {
    frameIt();
    const onSourceSelected = vi.fn();
    render(
      <MediaSourceBinder
        env={{ VITE_INPUT_SOURCE: "video", VITE_INPUT_URL: CONFIGURED }}
        onSourceSelected={onSourceSelected}
      />,
    );

    await waitFor(() => expect(onSourceSelected).toHaveBeenCalled());
    const announced = onSourceSelected.mock.calls[0][0];
    expect(announced.url).toBe(CONFIGURED);
    expect(announced.kind).not.toBe("webcam");
  });

  it("a configured video resolves to the same URL framed and unframed", async () => {
    render(
      <MediaSourceBinder
        env={{ VITE_INPUT_SOURCE: "video", VITE_INPUT_URL: CONFIGURED }}
      />,
    );
    await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
    const unframed = videoSrc;

    setMediaSource.mockClear();
    videoSrc = undefined;
    frameIt();
    render(
      <MediaSourceBinder
        env={{ VITE_INPUT_SOURCE: "video", VITE_INPUT_URL: CONFIGURED }}
      />,
    );
    await waitFor(() => expect(setMediaSource).toHaveBeenCalled());

    expect(videoSrc).toBe(unframed);
  });
});

// The SDK takes a stream with no `sourceKind` for a mirrored webcam and, since
// SDK 2.0.0-alpha.9, names every left/right reading from that. A clip or still
// bound without its kind shows the right picture with every side reversed.
describe("MediaSourceBinder · a clip or still is bound as what it is", () => {
  const CONFIGURED = "https://example.test/client-footage.mp4";

  it("the framed preset binds as a video", async () => {
    frameIt();
    render(<MediaSourceBinder />);

    await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
    expect(setMediaSource).toHaveBeenCalledWith(
      expect.objectContaining({ source: "stream", sourceKind: "video" }),
    );
  });

  it("a configured video binds as a video", async () => {
    render(
      <MediaSourceBinder
        env={{ VITE_INPUT_SOURCE: "video", VITE_INPUT_URL: CONFIGURED }}
      />,
    );

    await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
    expect(setMediaSource).toHaveBeenCalledWith(
      expect.objectContaining({ source: "stream", sourceKind: "video" }),
    );
  });

  it("a configured photo binds as an image", async () => {
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;

        naturalWidth = 4;

        naturalHeight = 4;

        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    render(
      <MediaSourceBinder
        env={{ VITE_INPUT_SOURCE: "photo", VITE_INPUT_URL: "/still.jpg" }}
      />,
    );

    await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
    expect(setMediaSource).toHaveBeenCalledWith(
      expect.objectContaining({ source: "stream", sourceKind: "image" }),
    );
  });

  it("the frame is drawn as filmed: no flip, because the SDK no longer mirrors it back", async () => {
    render(
      <MediaSourceBinder
        env={{ VITE_INPUT_SOURCE: "video", VITE_INPUT_URL: CONFIGURED }}
      />,
    );

    await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
    expect(ctx2d.drawImage).toHaveBeenCalled();
    expect(ctx2d.scale).not.toHaveBeenCalled();
    expect(ctx2d.drawImage.mock.calls[0].slice(1, 3)).toEqual([0, 0]);
  });
});

describe("MediaSourceBinder · unframed startup", () => {
  it("unframed with no configured source: the WEBCAM, exactly as shipped today", async () => {
    // A regression pin on the shipped default. Every published app runs this.
    render(<MediaSourceBinder />);

    await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
    expect(setMediaSource).toHaveBeenCalledWith({ source: "webcam" });
    expect(setMediaSource).toHaveBeenCalledTimes(1);
  });

  it("unframed: the switcher is told the WEBCAM is playing, so the control is honest", async () => {
    const onSourceSelected = vi.fn();
    render(<MediaSourceBinder onSourceSelected={onSourceSelected} />);

    await waitFor(() => expect(onSourceSelected).toHaveBeenCalled());
    expect(onSourceSelected.mock.calls[0][0].kind).toBe("webcam");
  });
});

// QA-F13-G11 (superseded by gallery-live-webcam): the gallery's Live frame puts
// `source=webcam` on the frame's address. A framed app on its webcam default then
// starts on the webcam; nothing else about the startup path moves.
describe("MediaSourceBinder · framed + source=webcam (the gallery's Live frame)", () => {
  const withSearch = (search: string) => {
    window.history.replaceState(null, "", `/${search}`);
  };

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it.each([
    "?source=webcam",
    "?source=%77ebcam",
    "?a=1&source=webcam",
    "?source=webcam&source=video",
  ])(
    "framed + default + %s: binds the WEBCAM and reports the Webcam preset",
    async (search) => {
      withSearch(search);
      frameIt();
      const onSourceSelected = vi.fn();
      render(<MediaSourceBinder onSourceSelected={onSourceSelected} />);

      await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
      expect(setMediaSource).toHaveBeenCalledWith({ source: "webcam" });
      expect(setMediaSource).toHaveBeenCalledTimes(1);
      expect(videoSrc).toBeUndefined();
      await waitFor(() => expect(onSourceSelected).toHaveBeenCalled());
      expect(onSourceSelected.mock.calls[0][0]).toEqual({
        id: "webcam",
        kind: "webcam",
        label: "Webcam",
      });
    },
  );

  it.each([
    "?source=Webcam",
    "?Source=webcam",
    "?source=webcam2",
    "?source=video",
    "?source=video&source=webcam",
    "#source=webcam",
  ])(
    "framed + default + %s: still the preset, getUserMedia never called",
    async (search) => {
      withSearch(search);
      frameIt();
      render(<MediaSourceBinder />);

      await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
      expect(setMediaSource).toHaveBeenCalledWith(
        expect.objectContaining({ source: "stream", stream: FAKE_STREAM }),
      );
      expect(sdkVideoMediaSources.map((p) => p.url)).toContain(videoSrc);
      expect(getUserMedia).not.toHaveBeenCalled();
    },
  );

  it("framed + CONFIGURED video + source=webcam: the creator's source wins", async () => {
    const CONFIGURED = "https://example.test/client-footage.mp4";
    withSearch("?source=webcam");
    frameIt();
    render(
      <MediaSourceBinder
        env={{ VITE_INPUT_SOURCE: "video", VITE_INPUT_URL: CONFIGURED }}
      />,
    );

    await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
    expect(videoSrc).toBe(CONFIGURED);
    expect(setMediaSource).not.toHaveBeenCalledWith(
      expect.objectContaining({ source: "webcam" }),
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("unframed + source=webcam: identical to the no-parameter result", async () => {
    withSearch("?source=webcam");
    render(<MediaSourceBinder />);

    await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
    expect(setMediaSource).toHaveBeenCalledWith({ source: "webcam" });
    expect(setMediaSource).toHaveBeenCalledTimes(1);
  });

  it.each(["NotAllowedError", "NotFoundError"])(
    "NO FALLBACK: a refused camera (%s) binds nothing else afterwards",
    async (name) => {
      // The SDK writes the failure to its session store (which paints the
      // template's CameraError) and rethrows. A build that caught the rethrow and
      // bound the sample clip would show a clip right after the visitor said no.
      const refusal = Object.assign(new Error("camera refused"), { name });
      setMediaSource.mockRejectedValueOnce(refusal);
      withSearch("?source=webcam");
      frameIt();
      render(<MediaSourceBinder />);

      await waitFor(() => expect(setMediaSource).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(setMediaSource).toHaveBeenCalledTimes(1);
      expect(setMediaSource).toHaveBeenCalledWith({ source: "webcam" });
      expect(videoSrc).toBeUndefined();
      expect(start).not.toHaveBeenCalled();
    },
  );
});
