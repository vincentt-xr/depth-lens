import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  XRProvider,
  XRScene,
  XRMediaSource,
} from "@vincentt-xr/sdk";
import {
  useXRContext,
  useXRError,
  useXRPipelineSnapshot,
  useXRReady,
} from "@vincentt-xr/sdk/low-level";
import { mountViewerBeacon, reportSession } from "@vincentt-xr/analytics";
import { openConsoleChannel } from "@vincentt-xr/harness";
import { PerspectiveCamera } from "@react-three/drei";

import { Scene } from "./Scene";
import { PreviewAnchors } from "./PreviewAnchors";
import { FrameContainer } from "./FrameContainer";
import { CaptureControls } from "./CaptureControls";
import {
  announcedPresets,
  chooseMediaSource,
  isFramed,
  pickFramedDefault,
  recordRequest,
  requestsWebcam,
} from "./framed";
import type { MediaSourceEnv } from "./framed";
import { streamFromImageUrl, streamFromVideoUrl } from "./mediaStream";
import {
  deriveExperienceStatus,
  publishExperienceStatus,
} from "./experienceStatus";
import { MediaSourceControl } from "./MediaSourceControl";
import type { MediaPreset } from "./MediaSourceControl";

// Fallback clip for the "video" source when no VITE_INPUT_URL is supplied.
// Referenced by URL (not bundled) so it stays out of the published bundle —
// publish runs the webcam default and never hits this path. Editor preview
// always passes a real VITE_INPUT_URL, so this is a dev/last-resort fallback.
// Read once: the address does not change while the app runs. In record mode the
// canvas keeps a fixed pixel ratio and adaptive quality stays off, so a photo
// or a take has the screen's resolution from the first frame to the last and
// the recorder never sees the buffer change size mid-file.
const RECORD = recordRequest();
const RECORD_CANVAS = RECORD.enabled
  ? { dpr: Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 2) }
  : {};

const FALLBACK_VIDEO_URL =
  "https://cdn.vincentt.studio/assets/sdk/debug-ui/v1/videos/idle-woman.mp4";
const MOBILE_XR_ACCEPTANCE_HARNESS_ENABLED =
  (globalThis as { VCT_MOBILE_XR_ACCEPTANCE_HARNESS?: boolean })
    .VCT_MOBILE_XR_ACCEPTANCE_HARNESS === true;
const MobileXRAcceptanceHarness = MOBILE_XR_ACCEPTANCE_HARNESS_ENABLED
  ? lazy(async () => ({
      default: (await import("./MobileXRAcceptanceHarness"))
        .MobileXRAcceptanceHarness,
    }))
  : null;

/**
 * Picks the media source and starts the XR session. Runs once on mount.
 *
 * VITE_INPUT_SOURCE controls the source:
 *   - "webcam" (default): live getUserMedia — UNLESS this app is framed, see below
 *   - "video": loop VITE_INPUT_URL (or FALLBACK_VIDEO_URL if unset)
 *   - "photo": draw VITE_INPUT_URL to a canvas as a static 1-frame stream
 *
 * Photo/video streams are bound with their `sourceKind`, so the SDK draws them
 * as filmed and names left/right as the person's own side. Without it a stream
 * is taken for a mirrored webcam.
 *
 * FRAMED: the webcam default is replaced by an SDK video preset, so a framed
 * app does not open on a camera prompt nobody asked for. If the app's own
 * address carries `source=webcam` (the gallery's Live frame), or the creator
 * built with `VITE_FRAMED_SOURCE=webcam`, it starts on the webcam instead. A
 * configured source is never overridden: see `chooseMediaSource`.
 */
export const MediaSourceBinder = ({
  onSourceSelected,
  env = import.meta.env,
}: {
  onSourceSelected?: (p: MediaPreset) => void;
  /** Injectable so the configured branches are drivable; defaults to the build's env. */
  env?: MediaSourceEnv;
}) => {
  const { session } = useXRContext();
  // The trackers the scene mounts register on their own mount effects, which
  // run AFTER this binder's (it is an earlier sibling). The framed branch waits
  // one macrotask before reading, so the list it sees is the scene's.
  const pipeline = useXRPipelineSnapshot();
  const pipelineRef = useRef(pipeline);
  pipelineRef.current = pipeline;

  useEffect(() => {
    let cancelled = false;
    let stopVideo: (() => void) | undefined;

    const init = async () => {
      const choice = chooseMediaSource(
        {
          VITE_INPUT_SOURCE: env.VITE_INPUT_SOURCE,
          VITE_INPUT_URL: env.VITE_INPUT_URL,
          VITE_FRAMED_SOURCE: env.VITE_FRAMED_SOURCE,
        },
        isFramed(),
        requestsWebcam(),
      );

      // The switcher is controlled and holds no source state of its own, so the
      // app announces what it actually bound. Without this the control has no
      // value to render and stays hidden — and in the framed case it is what
      // makes the preset APPEAR SELECTED rather than the control claiming
      // "Webcam" while a preset plays.
      if (choice.kind === "video") {
        const url = choice.url || FALLBACK_VIDEO_URL;
        const handle = await streamFromVideoUrl(url);
        stopVideo = handle.stop;
        if (cancelled) return;
        await session.setMediaSource({
          source: XRMediaSource.STREAM,
          stream: handle.stream,
          sourceKind: "video",
        });
        onSourceSelected?.({
          id: "configured",
          kind: "video",
          label: "Configured input",
          url,
        });
      } else if (choice.kind === "framedPreset") {
        // Dynamic import: the preset module carries 12 CDN URLs and must not
        // reach a production bundle through a static import from app source.
        const { sdkVideoMediaSources } = await import(
          "@vincentt-xr/sdk/debug-ui/media-source"
        );
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
        if (cancelled) return;
        // A hand scene opens on a hand clip, a body scene on a body clip.
        const preset = pickFramedDefault(
          sdkVideoMediaSources,
          pipelineRef.current,
        );
        if (!preset?.url)
          throw new Error("no video preset available for the framed default");
        const handle = await streamFromVideoUrl(preset.url);
        stopVideo = handle.stop;
        if (cancelled) return;
        await session.setMediaSource({
          source: XRMediaSource.STREAM,
          stream: handle.stream,
          sourceKind: "video",
        });
        onSourceSelected?.(preset);
      } else if (choice.kind === "photo") {
        const stream = await streamFromImageUrl(choice.url);
        if (cancelled) return;
        await session.setMediaSource({
          source: XRMediaSource.STREAM,
          stream,
          sourceKind: "image",
        });
        onSourceSelected?.({
          id: "configured",
          kind: "image",
          label: "Configured input",
          url: choice.url,
        });
      } else {
        await session.setMediaSource({ source: XRMediaSource.WEBCAM });
        onSourceSelected?.({ id: "webcam", kind: "webcam", label: "Webcam" });
      }

      if (cancelled) return;
      await session.start();
    };

    // The SDK writes a startup failure (a refused camera) to the session store,
    // which paints CameraError, then rethrows. The catch only keeps the rethrow
    // from surfacing as an unhandled rejection; it must never bind a fallback.
    void init().catch(() => {});

    return () => {
      cancelled = true;
      stopVideo?.();
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

export const Shell = () => {
  const ready = useXRReady();
  const xrError = useXRError();
  const reason = xrError?.reason;
  const { session } = useXRContext();

  // The app owns the selected source; the switcher only renders it. That is what
  // makes the framed default APPEAR SELECTED instead of the control claiming
  // "Webcam" while a preset plays.
  const [selected, setSelected] = useState<MediaPreset | null>(null);

  // Held freezes the PICTURE, not the experience. The whole visible composite is
  // one canvas — the clip plays into an offscreen canvas, is captureStream()-ed,
  // and the SDK blits it into a texture drawn INSIDE this r3f scene — so halting
  // the render loop alone freezes everything on screen. The media RAF loop, the
  // blit and the trackers keep running deliberately: stopping a camera track can
  // need a fresh permission gesture to restart, and rebinding a tracker is the
  // delicate path. The cost is that release JUMPS to where the world now is
  // rather than resuming from the frozen instant.
  const [paused, setPaused] = useState(false);

  const applySource = useCallback(
    (next: MediaPreset) => {
      // RELEASE FIRST, THEN APPLY. A swap performed while the render loop is
      // stopped lands behind a frozen picture, so the creator sees the media
      // control do nothing.
      //
      // `flushSync` is load-bearing, not defensive. Calling `setPaused(false)`
      // before `apply()` is NOT sufficient: it only queues a re-render, which
      // React runs after this handler returns, while `apply()` reaches
      // `setMediaSource` in a microtask that wins the race. The canvas would then
      // take the new source while still mounted with `frameloop: 'never'` — the
      // one-frame-behind-the-freeze this ordering exists to prevent. Flushing
      // commits the released frameloop before the swap is started.
      flushSync(() => setPaused(false));
      setSelected(next);
      const apply = async () => {
        if (next.kind === "webcam") {
          await session.setMediaSource({ source: XRMediaSource.WEBCAM });
          return;
        }
        if (!next.url) return;
        const sourceKind = next.kind === "image" ? "image" : "video";
        const stream =
          sourceKind === "image"
            ? await streamFromImageUrl(next.url)
            : (await streamFromVideoUrl(next.url)).stream;
        await session.setMediaSource({
          source: XRMediaSource.STREAM,
          stream,
          sourceKind,
        });
      };
      // The SDK rethrows after writing the failure to the session store, so the
      // error screen paints from that store either way and this catch is only
      // here to keep the rethrow from surfacing as an unhandled rejection.
      // Reachable since the frame gained a camera grant: the webcam entry used
      // to be filtered out before any tap could reach getUserMedia.
      void apply().catch(() => {});
    },
    [session],
  );

  // THE VIEWER BEACON.
  //
  // It lives in this never-edited shell because a creator forks the template and
  // diverges immediately — anything in a file they edit is unpatchable in every
  // creator's private copy.
  //
  // It takes no options and reads no environment: the endpoint is a literal inside
  // the package, so a creator's unrelated local API-URL setting can never redirect
  // their viewers' reports. It is inert off a published address, which is why
  // nothing is sent in dev, in preview, or on a creator's own domain.
  useEffect(() => mountViewerBeacon(), []);

  // `reportSession` is a second call rather than an argument to the mount because
  // the beacon package takes ZERO dependencies — including no `react` — so it
  // cannot read the SDK's hooks itself. This component is already inside
  // `<XRProvider>`, which is what makes the read possible at all.
  useEffect(() => {
    reportSession({ ready, reason });
  }, [ready, reason]);

  // THE PUBLIC STATUS, beside the private one. Same inputs, a different reader:
  // the page embedding this experience, which has no beacon to ask. Written to
  // `<html data-experience>`, dispatched on `window`, and posted to the parent
  // when framed. See experienceStatus.ts for the shape a host awaits.
  useEffect(() => {
    publishExperienceStatus(deriveExperienceStatus(ready, reason), reason);
  }, [ready, reason]);

  // THE CONSOLE'S CHANNEL, framed only.
  //
  // `openConsoleChannel` no-ops when unframed, so the guard here is about not
  // paying for the SDK import rather than about correctness. The presets come
  // from the same module the in-app switcher uses; only the data is needed, and
  // the switcher component itself is never loaded on this path.
  //
  // `applySource` is reused verbatim: the console names a preset id and the app
  // performs exactly the swap it would have performed from its own control. The
  // console never holds the stream, which is the property the whole design rests
  // on.
  useEffect(() => {
    if (!isFramed()) return undefined;
    let close: (() => void) | undefined;
    let cancelled = false;
    void import("@vincentt-xr/sdk/debug-ui/media-source").then((mod) => {
      if (cancelled) return;
      const presets = mod.defaultMediaSources as unknown as MediaPreset[];
      close = openConsoleChannel({
        presets: announcedPresets(presets),
        onSetMediaSource: (id) => {
          const preset = presets.find((p) => p.id === id);
          if (preset) applySource(preset);
        },
        // Supplying this handler is ALSO what declares `render-hold` in the
        // announce — the harness derives the capability from the wiring rather
        // than from a list passed beside it, so an app cannot advertise a hold it
        // does not perform. The console has no ack to detect that with.
        onSetRenderHold: setPaused,
      });
    });
    return () => {
      cancelled = true;
      close?.();
    };
  }, [applySource]);

  return (
    <FrameContainer>
      <XRScene
        loadingComponent={<Loading shouldFadeOut={ready} />}
        errorComponent={<CameraError />}
        loadingTransitionDuration={1000}
        style={{ width: "100%", height: "100%" }}
        // `canvasProps`, NOT a bare `frameloop` — this is `<XRScene>`, the SDK's
        // component, which owns the `<Canvas>`; r3f's prop does not exist here.
        // The SDK spreads this AFTER its own gl defaults, so this value wins.
        // A later path needing `preserveDrawingBuffer` (a screenshot, an
        // annotation capture) merges into `canvasProps.gl` rather than replacing
        // `canvasProps`, which would drop the freeze.
        canvasProps={{ frameloop: paused ? "never" : "always", ...RECORD_CANVAS }}
      >
        <MediaSourceBinder onSourceSelected={setSelected} />
        <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={45} />
        {/* No VideoBackground: the scene draws the camera itself, through the lens shader. */}
        <ambientLight intensity={1} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <Scene />
        <PreviewAnchors />
      </XRScene>
      <MediaSourceControl value={selected} onChange={applySource} />
      {RECORD.enabled ? <CaptureControls audio={RECORD.audio} /> : null}
      {MobileXRAcceptanceHarness ? (
        <Suspense fallback={null}>
          <MobileXRAcceptanceHarness ready={ready} error={xrError?.message} />
        </Suspense>
      ) : null}
    </FrameContainer>
  );
};

const App = () => (
  <XRProvider quality={RECORD.enabled ? false : undefined}>
    <Shell />
  </XRProvider>
);

export default App;
