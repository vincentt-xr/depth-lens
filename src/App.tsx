/* eslint-disable react/no-unknown-property */
import { useEffect } from "react";
import {
  XRProvider,
  XRScene,
  XRMediaSource,
  AspectRatioContainer,
} from "@vincentt-xr/sdk";
import { useXRContext, useXRReady, useXRError } from "@vincentt-xr/sdk/low-level";
import { PerspectiveCamera } from "@react-three/drei";

import { Scene } from "./Scene";
import { PreviewAnchors } from "./PreviewAnchors";

// Fallback clip for the "video" source when no VITE_INPUT_URL is supplied.
// Referenced by URL (not bundled) so it stays out of the published bundle —
// publish runs the webcam default and never hits this path. Editor preview
// always passes a real VITE_INPUT_URL, so this is a dev/last-resort fallback.
const FALLBACK_VIDEO_URL =
  "https://cdn.vincentt.studio/assets/preview/v2/videos/Head_tilt_woman.mp4";

/**
 * Picks the media source and starts the XR session. Runs once on mount.
 *
 * VITE_INPUT_SOURCE controls the source:
 *   - "webcam" (default): live getUserMedia
 *   - "video": loop VITE_INPUT_URL (or FALLBACK_VIDEO_URL if unset)
 *   - "photo": draw VITE_INPUT_URL to a canvas as a static 1-frame stream
 *
 * Photo/video sources are pre-mirrored to cancel the SDK's selfie flip.
 */
const MediaSourceBinder = () => {
  const { session } = useXRContext();

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;

    const init = async () => {
      const inputSource = import.meta.env.VITE_INPUT_SOURCE;
      const inputUrl = import.meta.env.VITE_INPUT_URL;

      if (inputSource === "video") {
        const video = document.createElement("video");
        video.crossOrigin = "anonymous";
        video.src = inputUrl || FALLBACK_VIDEO_URL;
        video.loop = true;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        await video.play();
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d canvas context unavailable");
        const draw = () => {
          if (cancelled) return;
          ctx.save();
          ctx.scale(-1, 1);
          ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
          ctx.restore();
          rafId = requestAnimationFrame(draw);
        };
        draw();
        const stream = (
          canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }
        ).captureStream();
        await session.setMediaSource({ source: XRMediaSource.STREAM, stream });
      } else if (inputSource === "photo" && inputUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`failed to load ${inputUrl}`));
          img.src = inputUrl;
        });
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d canvas context unavailable");
        ctx.scale(-1, 1);
        ctx.drawImage(img, -canvas.width, 0);
        const stream = (
          canvas as HTMLCanvasElement & {
            captureStream: (frameRate?: number) => MediaStream;
          }
        ).captureStream(0);
        await session.setMediaSource({ source: XRMediaSource.STREAM, stream });
      } else {
        await session.setMediaSource({ source: XRMediaSource.WEBCAM });
      }

      if (cancelled) return;
      await session.start();
    };

    init();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
    // Runs once — session is stable for the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
};

const Loading = ({ shouldFadeOut }: { shouldFadeOut: boolean }) => (
  <div
    className={`flex w-full h-full flex-col items-center justify-center gap-6 bg-[var(--color-bg-app)] text-[var(--color-fg-app)] ${
      shouldFadeOut ? "animate-fadeOut [animation-delay:0.3s]" : ""
    }`}
  >
    <svg
      viewBox="0 0 2040 2040"
      fill="currentColor"
      className="h-16 w-16 animate-breathe"
      aria-hidden="true"
    >
      <path d="M1736.06,394.62l-195.11,1201.52c-4.4,27.09-30.43,49.25-57.87,49.25h-416.79c17.53,0,31.13-15.24,29.14-32.66l-35.06-306.39,48.9-796.11c.76-13.07,12.02-25.27,24.98-27.2l601.81-88.41Z" />
      <path d="M1074.53,1645.38H456.54L304.16,427.57c-2.17-17.47,11.49-32.95,29.14-32.95H912.07c29.37,0,55.64,23.98,58.33,53.23l98.2,858.49,35.06,306.39c1.99,17.41-11.61,32.66-29.14,32.66Z" />
    </svg>
    <div className="flex flex-col items-center gap-1">
      <div className="text-base font-medium tracking-wide">Vincentt</div>
      <div className="text-sm text-[var(--color-fg-muted)]">Make it real.</div>
    </div>
  </div>
);

const CameraError = () => {
  const xrError = useXRError();
  return (
  <div className="flex w-full h-full flex-col items-center justify-center gap-4 bg-[var(--color-bg-app)] text-[var(--color-fg-app)] px-8 text-center">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-12 w-12 text-[var(--color-fg-muted)]"
      aria-hidden="true"
    >
      <path d="M2 2l20 20" />
      <path d="M15 7h2a2 2 0 0 1 2 2v2m-2 6H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2" />
      <path d="M9.5 9.5a3 3 0 0 0 4.2 4.2" />
    </svg>
    <div className="flex flex-col items-center gap-1">
      <div className="text-base font-medium tracking-wide">
        Camera unavailable
      </div>
      <div className="text-sm text-[var(--color-fg-muted)] max-w-xs">
        {xrError?.message ||
          "Allow camera access in your browser, then refresh the page."}
      </div>
    </div>
  </div>
  );
};

const Shell = () => {
  const ready = useXRReady();
  return (
    <AspectRatioContainer>
      <XRScene
        loadingComponent={<Loading shouldFadeOut={ready} />}
        errorComponent={<CameraError />}
        loadingTransitionDuration={1000}
        style={{ width: "100%", height: "100%" }}
      >
        <MediaSourceBinder />
        <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={45} />
        <ambientLight intensity={1} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <Scene />
        <PreviewAnchors />
      </XRScene>
    </AspectRatioContainer>
  );
};

const App = () => (
  <XRProvider>
    <Shell />
  </XRProvider>
);

export default App;
