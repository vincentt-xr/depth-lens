// CaptureControls.tsx — the `?record` camera UI. Protected shell.
//
// Night glass, per the design system's camera UI: a 76-unit shutter in the
// control band (tap for a photo, hold 300 ms to record, release to stop), a
// REC chip with the elapsed time in the HUD band, "Release to stop" above the
// shutter, a white 360 ms flash on a photo. No time limit, no mark on the file.
// Each capture goes straight to the device (see captureSave.ts). `audio`
// adds the microphone to recordings; the prompt comes with the first take.
//
// It records the SDK's own capture canvas through `session.captureStream`, so
// the file holds exactly what the canvas composites; DOM overlays (this UI,
// the footer) are not in it. Video is MP4 wherever the recorder can write it.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useMediaRecorder } from "@vincentt-xr/sdk";
import { useXRContext, useXRReady } from "@vincentt-xr/sdk/low-level";

import { isMicrophoneError, preferredVideoMimeType, saveCapture } from "./captureSave";

const HOLD_MS = 300;

const formatElapsed = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export const CaptureControls = ({ audio = false }: { audio?: boolean }) => {
  const { session } = useXRContext();
  const ready = useXRReady();
  const [flashKey, setFlashKey] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  // Why a take has no sound, or why it failed: its own line, never replaced
  // by "Saved", cleared when the next capture starts.
  const [warning, setWarning] = useState<string | null>(null);
  // The microphone, while it is available: a refused or missing mic drops to
  // video only for the rest of the session, with one caption saying so.
  const [mic, setMic] = useState(audio);
  const retryWithoutMic = useRef(false);
  const holdTimer = useRef<number | null>(null);
  const holding = useRef(false);

  const say = useCallback((outcome: "downloaded" | "shared" | "dismissed") => {
    if (outcome === "dismissed") return;
    setNote(outcome === "shared" ? "Saved to Photos" : "Saved");
    window.setTimeout(() => setNote(null), 1400);
  }, []);

  const recorder = useMediaRecorder({
    audio: mic,
    mimeType: preferredVideoMimeType(mic),
    onError: (error) => {
      // eslint-disable-next-line no-console -- the one place a refused mic is explained to a developer
      console.warn("[CaptureControls] recorder error", error.name, error.message);
      if (mic && isMicrophoneError(error)) {
        // The mic was refused or is absent; the SDK has already given up on
        // this take. Record it again without audio once the recorder re-forms.
        retryWithoutMic.current = true;
        setMic(false);
        setWarning(`No microphone (${error.name}): video only`);
      } else {
        setStartedAt(null);
        setWarning(`Recording failed (${error.name})`);
      }
    },
    onRecordingComplete: (blob) => {
      void blobToDataUrl(blob).then((dataUrl) =>
        saveCapture({ blob, dataUrl }, "video").then(say),
      );
    },
  });
  const recording = recorder.isRecording;

  useEffect(() => {
    if (!recording || startedAt === null) return undefined;
    const id = window.setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => window.clearInterval(id);
  }, [recording, startedAt]);

  const takePhoto = useCallback(() => {
    if (!ready) return;
    setNote(null);
    setWarning(null);
    setFlashKey((k) => k + 1);
    const dataUrl = session.captureFrame();
    void fetch(dataUrl)
      .then((r) => r.blob())
      .then((blob) => saveCapture({ blob, dataUrl }, "photo"))
      .then(say);
  }, [ready, say, session]);

  const startRecording = useCallback(async () => {
    if (!ready || recording) return;
    setNote(null);
    if (!retryWithoutMic.current) setWarning(null);
    setElapsed(0);
    setStartedAt(Date.now());
    await recorder.start(session.captureStream(30));
  }, [ready, recorder, recording, session]);

  useEffect(() => {
    if (!retryWithoutMic.current || mic) return;
    // Start the retake while the flag is still up, so it keeps the warning.
    if (holding.current) void startRecording();
    else setStartedAt(null);
    retryWithoutMic.current = false;
  }, [mic, startRecording]);

  const stopRecording = useCallback(() => {
    if (!recording) return;
    recorder.stop();
    setStartedAt(null);
  }, [recorder, recording]);

  const clearHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer has no capture; the hold still times out normally.
    }
    holding.current = false;
    clearHold();
    holdTimer.current = window.setTimeout(() => {
      holding.current = true;
      void startRecording();
    }, HOLD_MS);
  };

  const onPointerUp = () => {
    clearHold();
    if (holding.current) stopRecording();
    else takePhoto();
    holding.current = false;
  };

  const onPointerCancel = () => {
    clearHold();
    if (holding.current) stopRecording();
    holding.current = false;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (recording) stopRecording();
    else takePhoto();
  };

  useEffect(() => () => clearHold(), []);

  return (
    <div className="cam-layer" aria-live="polite">
      <div className="cam-scrim cam-scrim-top" />
      <div className="cam-scrim cam-scrim-bottom" />
      {flashKey > 0 ? <div key={flashKey} className="cam-flash" /> : null}
      <div className="cam-hud">
        {recording ? (
          <div className="cam-chip cam-chip-rec" role="status">
            <span className="cam-rec-dot" />
            <span className="cam-chip-value">{formatElapsed(elapsed)}</span>
          </div>
        ) : null}
        {!recording && note ? (
          <div className="cam-chip" role="status">
            <span className="cam-chip-text">{note}</span>
          </div>
        ) : null}
        {warning ? (
          <div className="cam-chip cam-chip-warn" role="alert">
            <span className="cam-chip-text">{warning}</span>
          </div>
        ) : null}
      </div>
      <div className="cam-controls">
        {recording ? <div className="cam-caption">Release to stop</div> : null}
        <button
          type="button"
          className={`cam-shutter${recording ? " cam-shutter-rec" : ""}`}
          aria-label={recording ? "Stop recording" : "Take a photo, hold to record"}
          aria-pressed={recording}
          disabled={!ready}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className="cam-shutter-ring" />
          <span className="cam-shutter-core" />
        </button>
      </div>
    </div>
  );
};
