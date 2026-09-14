// Photo + video capture primitives for Scene.tsx.
//
// Trigger-agnostic: wire these to a gesture handler, a click, a timer — the
// hooks don't care. Both return `{ blob, dataUrl }` so previews, downloads,
// uploads, and shares are all one-line follow-ups.
import { useCallback, useEffect, useRef, useState } from "react";

import { useMediaRecorder } from "@vincentt-xr/sdk";
import { useXRContext } from "@vincentt-xr/sdk/low-level";

export interface CapturedMedia {
  /** Raw blob — feed to upload, fetch, FileReader, etc. */
  blob: Blob;
  /** `data:` URL — feed to <img src>, <video src>, share, or saveToDevice. */
  dataUrl: string;
}

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const res = await fetch(dataUrl);
  return res.blob();
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * `usePhotoCapture()` — single-shot photo from the live R3F render.
 *
 * Returns `{ capture, latest }`. Call `capture()` to grab a frame; the
 * promise resolves to `{ blob, dataUrl }`. `latest` mirrors the most
 * recent capture for easy preview rendering.
 *
 * The SDK forces a fresh render before snapping, so the capture matches
 * what's on screen at call time — safe to call from any handler.
 */
export const usePhotoCapture = () => {
  const { session } = useXRContext();
  const [latest, setLatest] = useState<CapturedMedia | null>(null);

  const capture = useCallback(async (): Promise<CapturedMedia> => {
    const dataUrl = session.captureFrame();
    const blob = await dataUrlToBlob(dataUrl);
    const media = { blob, dataUrl };
    setLatest(media);
    return media;
  }, [session]);

  return { capture, latest };
};

/**
 * `useVideoCapture()` — start/stop video recording of the live canvas.
 *
 * Returns `{ start, stop, isRecording, latest }`. `start()` begins
 * recording the R3F canvas via captureStream + MediaRecorder; `stop()`
 * finalizes and resolves the resulting `{ blob, dataUrl }`. `latest`
 * mirrors the most recent recording.
 *
 * `audio: true` adds a microphone track (mobile / desktop). Default is
 * video-only so kiosk and silent contexts don't surface a mic prompt.
 */
export const useVideoCapture = (opts?: { audio?: boolean }) => {
  const audio = opts?.audio ?? false;
  const recorder = useMediaRecorder({ audio });
  const [latest, setLatest] = useState<CapturedMedia | null>(null);
  const onStopRef = useRef<((m: CapturedMedia) => void) | null>(null);

  // The recorder's `recordedBlob` only populates on stop. Watch it and
  // resolve the pending stop() promise once the blob arrives.
  useEffect(() => {
    if (!recorder.recordedBlob || !onStopRef.current) return;
    const blob = recorder.recordedBlob;
    blobToDataUrl(blob).then((dataUrl) => {
      const media = { blob, dataUrl };
      setLatest(media);
      onStopRef.current?.(media);
      onStopRef.current = null;
    });
  }, [recorder.recordedBlob]);

  const start = useCallback(async () => {
    const canvas = document.querySelector(
      "#vincentt-xr-canvas canvas, canvas",
    ) as HTMLCanvasElement | null;
    if (!canvas) throw new Error("useVideoCapture: no canvas mounted yet");
    type CaptureStreamCanvas = HTMLCanvasElement & {
      captureStream: (fps?: number) => MediaStream;
    };
    const stream = (canvas as CaptureStreamCanvas).captureStream(30);
    await recorder.start(stream);
  }, [recorder]);

  const stop = useCallback(
    () =>
      new Promise<CapturedMedia>((resolve) => {
        onStopRef.current = resolve;
        recorder.stop();
      }),
    [recorder],
  );

  return {
    start,
    stop,
    isRecording: recorder.isRecording,
    latest,
  };
};

/**
 * `saveToDevice(media, filename)` — trigger a browser download.
 *
 * Mobile: surfaces the share / save sheet. Desktop: writes to ~/Downloads.
 * Kiosk: typically not used — upload to a server instead.
 */
export const saveToDevice = (media: CapturedMedia, filename: string): void => {
  const url = URL.createObjectURL(media.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const inferExtension = (mime: string): string => {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return "bin";
};

/**
 * `shareMedia(media, opts?)` — open the native share sheet for a capture.
 *
 * On devices that support the Web Share API with file payloads (most
 * mobile browsers), this surfaces the OS share sheet so the user can send
 * the photo/video to Instagram, WhatsApp, Messages, etc. Where it isn't
 * available (most desktop browsers) it falls back to `saveToDevice`.
 *
 * Returns `{ shared }` — `true` if the native sheet opened, `false` if it
 * fell back to a download — so the UI can branch (e.g. show a QR "scan to
 * get it on your phone" prompt when `shared` is false).
 *
 * `filename` defaults to `capture.<ext>` inferred from the blob's MIME.
 * `title` / `text` populate the share sheet caption where supported.
 */
export const shareMedia = async (
  media: CapturedMedia,
  opts?: { filename?: string; title?: string; text?: string },
): Promise<{ shared: boolean }> => {
  const filename =
    opts?.filename ?? `capture.${inferExtension(media.blob.type)}`;
  const file = new File([media.blob], filename, { type: media.blob.type });

  // navigator.share with files is the goal; canShare gates it per-platform.
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  const shareData: ShareData = {
    files: [file],
    title: opts?.title,
    text: opts?.text,
  };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share(shareData);
      return { shared: true };
    } catch (err) {
      // AbortError = user dismissed the sheet; treat as a no-op success, not
      // a fallback (re-downloading after a deliberate cancel is surprising).
      if ((err as DOMException).name === "AbortError") return { shared: true };
      // Any other failure: fall through to download.
    }
  }

  saveToDevice(media, filename);
  return { shared: false };
};
