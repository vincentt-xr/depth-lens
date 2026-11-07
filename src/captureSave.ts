// captureSave.ts — hand a capture to the device the way each platform expects.
//
// Desktop and Android: a download; the browser files it under Downloads (Android
// also lists it in the gallery once the media scanner sees it). iOS: a download
// attribute cannot reach the camera roll, so the share sheet carries the file
// and "Save Image" / "Save Video" puts it in Photos. A dismissed sheet is a
// decision, not a failure: nothing else happens. Without share support the
// download runs everywhere.
import type { CapturedMedia } from "./capture";
import { saveToDevice } from "./capture";

export const isIOS = (nav: Navigator = navigator): boolean =>
  /iP(hone|ad|od)/.test(nav.userAgent) ||
  (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);

/**
 * The video container and codecs: MP4 everywhere it records; WebM only where
 * it cannot. With a microphone the string must name an audio codec too, or
 * Chromium refuses the recorder once an audio track is on the stream.
 */
export const preferredVideoMimeType = (audio = false): string => {
  const mr = (globalThis as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } })
    .MediaRecorder;
  const ok = (t: string) => mr?.isTypeSupported?.(t) ?? false;
  const candidates = audio
    ? [
        "video/mp4;codecs=avc1,mp4a.40.2",
        "video/mp4;codecs=avc1,opus",
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm",
      ]
    : ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  return candidates.find(ok) ?? candidates[candidates.length - 1];
};

/** Errors that mean the microphone itself could not be opened. */
export const isMicrophoneError = (error: Error): boolean =>
  [
    "NotAllowedError",
    "NotFoundError",
    "NotReadableError",
    "OverconstrainedError",
    "SecurityError",
    "AbortError",
  ].includes(error.name);

const extensionOf = (mime: string) => {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return "bin";
};

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/**
 * Save a capture: `kind` names the file ("photo" or "video"). Returns how it
 * went so the UI can word its caption.
 */
export const saveCapture = async (
  media: CapturedMedia,
  kind: "photo" | "video",
): Promise<"downloaded" | "shared" | "dismissed"> => {
  const filename = `${kind}-${stamp()}.${extensionOf(media.blob.type)}`;
  if (isIOS()) {
    const file = new File([media.blob], filename, { type: media.blob.type });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file] });
        return "shared";
      } catch (err) {
        if ((err as DOMException).name === "AbortError") return "dismissed";
      }
    }
  }
  saveToDevice(media, filename);
  return "downloaded";
};
