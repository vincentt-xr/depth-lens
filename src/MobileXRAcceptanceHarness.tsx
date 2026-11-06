import { useState } from "react";

import { usePhotoCapture, useVideoCapture } from "./capture";

type HarnessResult = "not-run" | "passed" | "failed";

const RESULT_LABEL: Record<HarnessResult, string> = {
  "not-run": "Not run",
  passed: "Passed",
  failed: "Failed",
};

/**
 * Development-only controls for exercising the real template shell on a phone.
 *
 * This does not simulate camera permissions, layout, or capture. It triggers
 * the same canvas capture hooks and sits beside the app's real media switcher,
 * so a tester can record evidence while following docs/mobile-xr-acceptance.md.
 */
export const MobileXRAcceptanceHarness = ({
  ready,
  error,
}: {
  ready: boolean;
  error?: string;
}) => {
  const photo = usePhotoCapture();
  const video = useVideoCapture();
  const [photoResult, setPhotoResult] = useState<HarnessResult>("not-run");
  const [videoResult, setVideoResult] = useState<HarnessResult>("not-run");
  const [message, setMessage] = useState(
    "Use the source switcher, then run the device checklist.",
  );

  const capturePhoto = async () => {
    try {
      await photo.capture();
      setPhotoResult("passed");
      setMessage("Photo captured from the active XR canvas.");
    } catch (cause) {
      setPhotoResult("failed");
      setMessage(
        cause instanceof Error ? cause.message : "Photo capture failed.",
      );
    }
  };

  const toggleVideo = async () => {
    try {
      if (video.isRecording) {
        await video.stop();
        setVideoResult("passed");
        setMessage("Video recording completed from the active XR canvas.");
      } else {
        await video.start();
        setMessage(
          "Recording. Move or switch the source, then stop recording.",
        );
      }
    } catch (cause) {
      setVideoResult("failed");
      setMessage(
        cause instanceof Error ? cause.message : "Video capture failed.",
      );
    }
  };

  return (
    <aside
      aria-label="Mobile XR acceptance harness"
      style={{
        position: "absolute",
        zIndex: 20,
        top: 12,
        left: 12,
        maxWidth: 280,
        padding: 12,
        borderRadius: 10,
        background: "rgba(15, 23, 42, 0.9)",
        color: "#f8fafc",
        font: "12px/1.4 system-ui, sans-serif",
      }}
    >
      <strong>Mobile XR acceptance</strong>
      <p style={{ margin: "6px 0" }}>
        Session: {ready ? "ready" : "starting"}
        {error ? ` — ${error}` : ""}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => void capturePhoto()}>
          Capture photo
        </button>
        <button type="button" onClick={() => void toggleVideo()}>
          {video.isRecording ? "Stop video" : "Record video"}
        </button>
      </div>
      <p style={{ margin: "8px 0 0" }}>Photo: {RESULT_LABEL[photoResult]}</p>
      <p style={{ margin: "2px 0 0" }}>Video: {RESULT_LABEL[videoResult]}</p>
      <p style={{ margin: "8px 0 0", color: "#cbd5e1" }}>{message}</p>
      <p style={{ margin: "8px 0 0" }}>
        Follow <code>docs/mobile-xr-acceptance.md</code> for permission,
        orientation, source, touch, restart, and overlay checks.
      </p>
    </aside>
  );
};
