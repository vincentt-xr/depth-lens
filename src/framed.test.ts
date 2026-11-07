import { describe, expect, it, vi } from "vitest";

import {
  FRAMED_SOURCE_PARAM,
  FRAMED_SOURCE_WEBCAM,
  announcedPresets,
  chooseMediaSource,
  isFramed,
  pickFramedDefault,
  recordRequest,
  requestsRecord,
  requestsWebcam,
} from "./framed";

const TOP = { name: "top" };

describe("isFramed", () => {
  it("is false at the top level", () => {
    const w = { self: TOP, top: TOP };
    expect(isFramed(w)).toBe(false);
  });

  it("is true inside a frame", () => {
    expect(isFramed({ self: { name: "inner" }, top: TOP })).toBe(true);
  });

  it("is true inside ANY frame, not only a known embedder", () => {
    // No sender, no parameter, no message — the app reads a fact about itself,
    // so an unrecognised embedder is treated exactly like the console.
    expect(
      isFramed({
        self: { name: "someone-elses-page" },
        top: { name: "theirs" },
      }),
    ).toBe(true);
  });

  it("folds a throwing window to NOT framed", () => {
    // The safe direction: an unknown context behaves like today's shipped
    // top-level case rather than silently swapping the creator's camera.
    const hostile = {
      get self() {
        throw new Error("cross-origin");
      },
      top: TOP,
    };
    expect(
      isFramed(hostile as unknown as { self: unknown; top: unknown }),
    ).toBe(false);
  });
});

describe("chooseMediaSource", () => {
  it("framed with no configured source selects the framed preset, never the webcam", () => {
    expect(chooseMediaSource({}, true)).toEqual({ kind: "framedPreset" });
  });

  it("unframed with no configured source selects the webcam — the shipped default, unchanged", () => {
    // A REGRESSION PIN. Every published app runs this branch; if the framing
    // check ever leaks into it, creators lose their camera on their own machine.
    expect(chooseMediaSource({}, false)).toEqual({ kind: "webcam" });
  });

  it("a configured video source wins when framed — the creator's choice is not overridden", () => {
    const env = {
      VITE_INPUT_SOURCE: "video",
      VITE_INPUT_URL: "https://example.test/clip.mp4",
    };
    expect(chooseMediaSource(env, true)).toEqual({
      kind: "video",
      url: "https://example.test/clip.mp4",
    });
  });

  it("a configured photo source wins when framed", () => {
    const env = {
      VITE_INPUT_SOURCE: "photo",
      VITE_INPUT_URL: "https://example.test/still.jpg",
    };
    expect(chooseMediaSource(env, true)).toEqual({
      kind: "photo",
      url: "https://example.test/still.jpg",
    });
  });

  it("a configured source behaves identically framed and unframed", () => {
    const env = {
      VITE_INPUT_SOURCE: "video",
      VITE_INPUT_URL: "https://example.test/clip.mp4",
    };
    expect(chooseMediaSource(env, true)).toEqual(chooseMediaSource(env, false));
  });

  it("photo without a URL is not a configured source, so framing still decides", () => {
    expect(chooseMediaSource({ VITE_INPUT_SOURCE: "photo" }, true)).toEqual({
      kind: "framedPreset",
    });
    expect(chooseMediaSource({ VITE_INPUT_SOURCE: "photo" }, false)).toEqual({
      kind: "webcam",
    });
  });

  it("an unrecognised source value falls through to the framing-aware default", () => {
    expect(chooseMediaSource({ VITE_INPUT_SOURCE: "webcam" }, true)).toEqual({
      kind: "framedPreset",
    });
    expect(chooseMediaSource({ VITE_INPUT_SOURCE: "webcam" }, false)).toEqual({
      kind: "webcam",
    });
  });

  it("framed + VITE_FRAMED_SOURCE=webcam: the creator keeps the camera in every embed", () => {
    expect(chooseMediaSource({ VITE_FRAMED_SOURCE: "webcam" }, true)).toEqual({
      kind: "webcam",
    });
    // Unframed it changes nothing — the webcam was the default already.
    expect(chooseMediaSource({ VITE_FRAMED_SOURCE: "webcam" }, false)).toEqual({
      kind: "webcam",
    });
  });

  it("VITE_FRAMED_SOURCE is exact: anything but `webcam` keeps the preset default", () => {
    expect(chooseMediaSource({ VITE_FRAMED_SOURCE: "Webcam" }, true)).toEqual({
      kind: "framedPreset",
    });
    expect(chooseMediaSource({ VITE_FRAMED_SOURCE: "true" }, true)).toEqual({
      kind: "framedPreset",
    });
    expect(chooseMediaSource({ VITE_FRAMED_SOURCE: "" }, true)).toEqual({
      kind: "framedPreset",
    });
  });

  it("a configured source still wins over the creator's framed-webcam opt-in", () => {
    const env = {
      VITE_FRAMED_SOURCE: "webcam",
      VITE_INPUT_SOURCE: "video",
      VITE_INPUT_URL: "u",
    };
    expect(chooseMediaSource(env, true)).toEqual({ kind: "video", url: "u" });
  });

  const ENVS = [
    {},
    { VITE_INPUT_SOURCE: "webcam" },
    { VITE_INPUT_SOURCE: "photo" },
    { VITE_INPUT_SOURCE: "nonsense", VITE_INPUT_URL: "https://example.test/x" },
    { VITE_INPUT_URL: "https://example.test/x" },
    { VITE_INPUT_SOURCE: "video" },
    { VITE_INPUT_SOURCE: "photo", VITE_INPUT_URL: "https://example.test/x" },
  ];

  it("never yields a webcam choice when framed WITHOUT the parameter, for any env", () => {
    // f13's console frame never carries the parameter, so its startup path
    // cannot reach getUserMedia BY CONSTRUCTION.
    ENVS.forEach((env) => {
      expect(chooseMediaSource(env, true).kind).not.toBe("webcam");
      expect(chooseMediaSource(env, true, false).kind).not.toBe("webcam");
    });
  });

  it("framed + webcam default + the parameter selects the webcam", () => {
    [
      {},
      { VITE_INPUT_SOURCE: "webcam" },
      { VITE_INPUT_SOURCE: "photo" },
    ].forEach((env) => {
      expect(chooseMediaSource(env, true, true)).toEqual({ kind: "webcam" });
    });
    expect(
      chooseMediaSource(
        { VITE_INPUT_SOURCE: "nonsense", VITE_INPUT_URL: "x" },
        true,
        true,
      ),
    ).toEqual({ kind: "webcam" });
  });

  it("a configured source wins over the parameter, framed or not", () => {
    // A build that checked the parameter before the env passes every webcam arm
    // and fails only here.
    const video = {
      VITE_INPUT_SOURCE: "video",
      VITE_INPUT_URL: "https://example.test/clip.mp4",
    };
    const photo = {
      VITE_INPUT_SOURCE: "photo",
      VITE_INPUT_URL: "https://example.test/p.png",
    };
    [true, false].forEach((framed) => {
      expect(chooseMediaSource(video, framed, true)).toEqual({
        kind: "video",
        url: "https://example.test/clip.mp4",
      });
      expect(chooseMediaSource(photo, framed, true)).toEqual({
        kind: "photo",
        url: "https://example.test/p.png",
      });
    });
  });

  it("unframed: the parameter changes nothing (a REGRESSION PIN on the shipped default)", () => {
    ENVS.forEach((env) => {
      expect(chooseMediaSource(env, false, true)).toEqual(
        chooseMediaSource(env, false),
      );
    });
  });
});

describe("requestsWebcam", () => {
  it("names the one parameter and the one value", () => {
    expect(FRAMED_SOURCE_PARAM).toBe("source");
    expect(FRAMED_SOURCE_WEBCAM).toBe("webcam");
  });

  it.each([
    "?source=webcam",
    "?source=%77ebcam",
    "?a=1&source=webcam",
    "?source=webcam&source=video",
  ])("%s asks for the webcam", (search) => {
    expect(requestsWebcam(search)).toBe(true);
  });

  it.each([
    "",
    "?source=Webcam",
    "?Source=webcam",
    "?source=webcam2",
    "?source=video",
    "?source=video&source=webcam",
    "#source=webcam",
    "?a=1",
  ])("%j does not", (search) => {
    expect(requestsWebcam(search)).toBe(false);
  });

  it("reads the document's own location.search by default", () => {
    window.history.replaceState(null, "", "/?source=webcam");
    try {
      expect(requestsWebcam()).toBe(true);
    } finally {
      window.history.replaceState(null, "", "/");
    }
    expect(requestsWebcam()).toBe(false);
  });

  it("the hash is never read", () => {
    window.history.replaceState(null, "", "/#source=webcam");
    try {
      expect(requestsWebcam()).toBe(false);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("fails closed when location access throws", () => {
    const spy = vi.spyOn(window, "location", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(requestsWebcam()).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("fails closed with no window", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(requestsWebcam()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("pickFramedDefault", () => {
  it("picks a VIDEO preset, so the creator sees the tracker respond rather than a frozen detection", () => {
    const presets = [
      { id: "sdk-image-1", kind: "image" },
      { id: "sdk-video-1", kind: "video" },
      { id: "sdk-video-2", kind: "video" },
    ];
    expect(pickFramedDefault(presets)).toEqual({
      id: "sdk-video-1",
      kind: "video",
    });
  });

  it("picks by kind, not by index, so an upstream reorder still yields a video", () => {
    const presets = [
      { id: "webcam", kind: "webcam" },
      { id: "sdk-image-1", kind: "image" },
      { id: "sdk-video-1", kind: "video" },
    ];
    expect(pickFramedDefault(presets)?.kind).toBe("video");
  });

  it("is undefined when there is no video preset, rather than falling back to a webcam entry", () => {
    expect(
      pickFramedDefault([{ id: "webcam", kind: "webcam" }]),
    ).toBeUndefined();
  });

  const TAGGED = [
    { id: "sdk-video-1", kind: "video", tags: ["face", "body"] },
    { id: "sdk-video-2", kind: "video", tags: ["face"] },
    { id: "sdk-video-6", kind: "video", tags: ["hand"] },
    { id: "sdk-video-7", kind: "video", tags: ["hand", "face", "body"] },
  ];

  it("a hand scene opens on the first hand-tagged clip", () => {
    expect(pickFramedDefault(TAGGED, ["vincentt.xr.hand-tracker"])?.id).toBe(
      "sdk-video-6",
    );
    expect(pickFramedDefault(TAGGED, ["vincentt.xr.gesture-tracker"])?.id).toBe(
      "sdk-video-6",
    );
  });

  it("hand outranks body outranks face when a scene mounts several trackers", () => {
    expect(
      pickFramedDefault(TAGGED, [
        "vincentt.xr.face-tracker",
        "vincentt.xr.hand-tracker",
      ])?.id,
    ).toBe("sdk-video-6");
    expect(
      pickFramedDefault(TAGGED, [
        "vincentt.xr.face-tracker",
        "vincentt.xr.body-tracker",
      ])?.id,
    ).toBe("sdk-video-1");
    expect(pickFramedDefault(TAGGED, ["vincentt.xr.face-tracker"])?.id).toBe(
      "sdk-video-1",
    );
  });

  it("falls back to the first video when no preset carries the wanted tag, or presets carry none", () => {
    const untagged = [
      { id: "sdk-video-1", kind: "video" },
      { id: "sdk-video-2", kind: "video" },
    ];
    expect(pickFramedDefault(untagged, ["vincentt.xr.hand-tracker"])?.id).toBe(
      "sdk-video-1",
    );
    const faceOnly = TAGGED.filter((p) => !p.tags.includes("hand"));
    expect(pickFramedDefault(faceOnly, ["vincentt.xr.hand-tracker"])?.id).toBe(
      "sdk-video-1",
    );
  });

  it("ignores trackers it does not know", () => {
    expect(pickFramedDefault(TAGGED, ["vincentt.xr.segmentation"])?.id).toBe(
      "sdk-video-1",
    );
  });
});

describe("announcedPresets", () => {
  const presets = [
    { id: "webcam", kind: "webcam", label: "Webcam", url: undefined },
    {
      id: "sdk-video-1",
      kind: "video",
      label: "Head tilt",
      url: "https://cdn.test/v1.mp4",
    },
    {
      id: "sdk-image-1",
      kind: "image",
      label: "Portrait",
      url: "https://cdn.test/i1.jpg",
    },
  ];

  it("translates the SDK's `webcam` to the wire's `camera`", () => {
    expect(announcedPresets(presets).map((p) => p.kind)).toEqual([
      "camera",
      "video",
      "image",
    ]);
  });

  it("never puts a url on the wire, whatever the SDK carries", () => {
    announcedPresets(presets).forEach((announced) => {
      expect(Object.keys(announced).sort()).toEqual([
        "id",
        "kind",
        "label",
        "mirrored",
      ]);
    });
  });

  it("marks the camera mirrored and everything else not", () => {
    const byId = Object.fromEntries(
      announcedPresets(presets).map((p) => [p.id, p.mirrored]),
    );
    expect(byId).toEqual({
      webcam: true,
      "sdk-video-1": false,
      "sdk-image-1": false,
    });
  });

  it("preserves id, label and the announced order", () => {
    expect(announcedPresets(presets).map((p) => [p.id, p.label])).toEqual([
      ["webcam", "Webcam"],
      ["sdk-video-1", "Head tilt"],
      ["sdk-image-1", "Portrait"],
    ]);
  });

  it("drops a kind outside the closed vocabulary rather than passing it through", () => {
    // An SDK that adds a kind must not be able to put an entry the console
    // cannot render into console chrome.
    const withUnknown = [
      ...presets,
      { id: "future", kind: "hologram", label: "Hologram" },
    ];
    expect(announcedPresets(withUnknown).map((p) => p.id)).not.toContain(
      "future",
    );
    expect(announcedPresets(withUnknown)).toHaveLength(3);
  });

  it("is empty for an empty list, not undefined", () => {
    expect(announcedPresets([])).toEqual([]);
  });
});

describe("requestsRecord", () => {
  it("is off without the parameter", () => {
    expect(requestsRecord("")).toBe(false);
    expect(requestsRecord("?source=webcam")).toBe(false);
  });

  it("is on when `record` is present, with or without a value", () => {
    expect(requestsRecord("?record")).toBe(true);
    expect(requestsRecord("?record=1")).toBe(true);
    expect(requestsRecord("?source=webcam&record=true")).toBe(true);
  });

  it("switches off for 0, false, no and off", () => {
    expect(requestsRecord("?record=0")).toBe(false);
    expect(requestsRecord("?record=false")).toBe(false);
    expect(requestsRecord("?record=No")).toBe(false);
    expect(requestsRecord("?record=off")).toBe(false);
  });

  it("reads the first value only", () => {
    expect(requestsRecord("?record=0&record=1")).toBe(false);
  });

  it("`audio` turns the microphone on, nothing else does", () => {
    expect(recordRequest("?record=audio")).toEqual({ enabled: true, audio: true });
    expect(recordRequest("?record=Audio")).toEqual({ enabled: true, audio: true });
    expect(recordRequest("?record=1")).toEqual({ enabled: true, audio: false });
    expect(recordRequest("?record=off")).toEqual({ enabled: false, audio: false });
    expect(recordRequest("")).toEqual({ enabled: false, audio: false });
  });

  it("folds a missing window to false", () => {
    const original = globalThis.window;
    // @ts-expect-error — simulate a non-browser context
    delete globalThis.window;
    try {
      expect(requestsRecord()).toBe(false);
    } finally {
      globalThis.window = original;
    }
  });
});
