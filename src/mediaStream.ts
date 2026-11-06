/**
 * Canvas-backed media streams for every NON-webcam source.
 *
 * One mechanism for all of them — the configured `video`/`photo` sources, the
 * framed preset default, and a runtime switch from the media switcher — so the
 * framed path adds no second way to produce a stream.
 *
 * Frames are drawn as filmed, never mirrored. The binder passes `sourceKind`
 * ("video" / "image") with each stream, so the SDK draws it straight and names
 * left and right as the person's own side. Pre-mirroring here while binding it
 * as the default "webcam" kind would show the same picture but tell the SDK the
 * feed is a mirrored selfie, which reverses every left/right reading.
 *
 * Nothing here touches `getUserMedia`. That call has exactly one site in this
 * app (the webcam branch of `MediaSourceBinder`), which is what lets the framed
 * startup path be webcam-free by construction rather than by care.
 */

type CaptureCanvas = HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream };

export type VideoStreamHandle = {
  stream: MediaStream;
  /** Stops the drawing RAF loop. Safe to call more than once. */
  stop: () => void;
};

/** How long to wait before asking a refused clip to play again. */
export const PLAY_RETRY_MS = 500;

/** Resolves once the clip's metadata is known; rejects when it cannot load. */
const whenMetadataLoaded = (video: HTMLVideoElement): Promise<void> =>
  new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    const listeners: Array<[string, () => void]> = [];
    const settle = (done: () => void) => () => {
      listeners.forEach(([event, handler]) => video.removeEventListener(event, handler));
      done();
    };
    listeners.push(
      ["loadedmetadata", settle(resolve)],
      ["error", settle(() => reject(new Error(`failed to load ${video.src}`)))],
    );
    listeners.forEach(([event, handler]) => video.addEventListener(event, handler));
  });

/**
 * A looping clip, drawn into a canvas and captured as a live stream.
 *
 * `play()` IS RETRIED, NOT AWAITED ONCE. Chrome rejects `play()` for a muted,
 * video-only element in a hidden or embedded tab (the editor's preview browser,
 * a backgrounded tab), and a single awaited call turned that into a failed
 * source swap: the clip never bound and the app sat on the loading screen. The
 * stream is now built as soon as the clip's dimensions are known, and playback
 * is asked for again on a timer and whenever the tab becomes visible, until it
 * sticks or the handle is stopped. Frames start flowing the moment the browser
 * allows them (vincentt-xr/v2-template#113).
 */
export const streamFromVideoUrl = async (url: string): Promise<VideoStreamHandle> => {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.src = url;
  video.loop = true;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;

  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let detachVisibility: () => void = () => {};
  /** Ends the retry loop and its listener. Safe to call more than once. */
  const teardown = () => {
    stopped = true;
    clearTimeout(retryTimer);
    detachVisibility();
  };
  let resolvePlayed: () => void = () => {};
  const played = new Promise<void>((resolve) => {
    resolvePlayed = resolve;
  });
  const tryPlay = async () => {
    if (stopped) return;
    try {
      await video.play();
      resolvePlayed();
    } catch {
      if (stopped) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void tryPlay(), PLAY_RETRY_MS);
    }
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void tryPlay();
  };
  document.addEventListener("visibilitychange", onVisible);
  detachVisibility = () => document.removeEventListener("visibilitychange", onVisible);

  // The first attempt and the metadata wait run together: a clip that is
  // allowed to play has its metadata by the time `play()` resolves, and one
  // that is refused still loads metadata, which is all the canvas needs. The
  // race means a refusal costs nothing but the frames until it is allowed.
  void tryPlay();
  try {
    await Promise.race([whenMetadataLoaded(video), played]);
  } catch (err) {
    teardown();
    throw err;
  }

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    teardown();
    throw new Error("2d canvas context unavailable");
  }

  let rafId = 0;
  const draw = () => {
    if (stopped) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    rafId = requestAnimationFrame(draw);
  };
  draw();

  return {
    stream: (canvas as CaptureCanvas).captureStream(),
    stop: () => {
      teardown();
      if (rafId) cancelAnimationFrame(rafId);
      video.pause();
    },
  };
};

/** A still, drawn into a canvas and captured as a one-frame stream. */
export const streamFromImageUrl = async (url: string): Promise<MediaStream> => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.drawImage(img, 0, 0);

  return (canvas as CaptureCanvas).captureStream(0);
};
