// #113 — a refused `play()` does not break the clip source; it is retried.
//
// jsdom implements neither media playback nor canvas capture, so both are
// stubbed at the prototype. The stubs ARE the scenario: Chrome rejecting
// `play()` for a video-only element in a hidden tab is exactly a rejecting
// `play`, and the metadata event is what a loading clip still fires there.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLAY_RETRY_MS, streamFromVideoUrl } from "./mediaStream";

const fakeStream = { id: "fake" } as unknown as MediaStream;

let playCalls: number;
let playResults: Array<"ok" | "refuse">;

beforeEach(() => {
  vi.useFakeTimers();
  playCalls = 0;
  playResults = [];
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function play(
    this: HTMLVideoElement,
  ) {
    playCalls += 1;
    const result = playResults.shift() ?? "ok";
    // A clip the browser accepts, or refuses, still loads its metadata.
    queueMicrotask(() => {
      Object.defineProperty(this, "videoWidth", { value: 640, configurable: true });
      Object.defineProperty(this, "videoHeight", { value: 480, configurable: true });
      Object.defineProperty(this, "readyState", { value: 1, configurable: true });
      this.dispatchEvent(new Event("loadedmetadata"));
    });
    return result === "ok"
      ? Promise.resolve()
      : Promise.reject(new DOMException("play() failed because the document is hidden", "NotAllowedError"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    save() {},
    restore() {},
    scale() {},
    drawImage() {},
  } as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
  (HTMLCanvasElement.prototype as unknown as { captureStream: () => MediaStream }).captureStream =
    () => fakeStream;
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("streamFromVideoUrl", () => {
  it("resolves with a stream when play is accepted first time", async () => {
    const handle = await streamFromVideoUrl("/clip.mp4");
    expect(handle.stream).toBe(fakeStream);
    expect(playCalls).toBe(1);
    handle.stop();
  });

  it("still resolves when play is refused, and retries until it sticks", async () => {
    playResults = ["refuse", "refuse", "ok"];
    const handle = await streamFromVideoUrl("/clip.mp4");
    // The source bound on metadata alone — the refusal did not surface.
    expect(handle.stream).toBe(fakeStream);
    expect(playCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(PLAY_RETRY_MS);
    expect(playCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(PLAY_RETRY_MS);
    expect(playCalls).toBe(3);
    // Accepted on the third try: no further retries are scheduled.
    await vi.advanceTimersByTimeAsync(PLAY_RETRY_MS * 4);
    expect(playCalls).toBe(3);
    handle.stop();
  });

  it("retries at once when the tab becomes visible", async () => {
    playResults = ["refuse", "ok"];
    const handle = await streamFromVideoUrl("/clip.mp4");
    expect(playCalls).toBe(1);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(playCalls).toBe(2);
    handle.stop();
  });

  it("stops retrying once the handle is stopped", async () => {
    playResults = ["refuse", "refuse", "refuse", "refuse"];
    const handle = await streamFromVideoUrl("/clip.mp4");
    handle.stop();
    await vi.advanceTimersByTimeAsync(PLAY_RETRY_MS * 4);
    expect(playCalls).toBe(1);
    // The visibility listener is gone too.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(playCalls).toBe(1);
  });

  it("rejects when the clip cannot load at all", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function play(
      this: HTMLVideoElement,
    ) {
      queueMicrotask(() => this.dispatchEvent(new Event("error")));
      return Promise.reject(new Error("no source"));
    });
    await expect(streamFromVideoUrl("/missing.mp4")).rejects.toThrow("failed to load");
  });
});
