# Vincentt Project — Template Grounding

This file documents the **template-local helpers** that live in this project's
`src/` (capture, gesture-hold, HTML overlays, sprite-sheet animation), plus
project-shape notes and common patterns.

The **SDK component/hook API** (`@vincentt-xr/sdk` — trackers, screen-space
layout, `<TextLabel>`, `<Panel>`, mesh/texture conventions) is documented in the
**SDK grounding**, which ships with the SDK. In a running project the platform
combines the SDK grounding with this file into the `GROUNDING.md` the agent reads,
so the agent sees one complete reference. (Developing locally across both repos?
The SDK API reference is `xr-sdk/GROUNDING.md` in your sibling checkout.)

Edit `src/Scene.tsx`. Compose the SDK components/hooks with the template helpers
below and R3F primitives. There is no lifecycle DSL — per-frame logic is R3F
`useFrame`, per-mount setup is `useEffect`, both inside the scene component.

---

## `useGestureHold({ gesture, holdMs, armDelayMs, enabled, onTrigger })` — hold-to-trigger (from `src/gesture.ts`)

`<GestureTrigger>` (SDK) is one-shot. `useGestureHold` fires after a gesture has been **held** for `holdMs`, debounced so a stray misclassified frame can't latch it. It re-arms when the gesture is released, so the next hold fires again. Needs a `<GestureTracker />` (SDK) mounted.

```tsx
import { GestureTracker } from "@vincentt-xr/sdk/tracking";
import { useGestureHold } from "./gesture";

<GestureTracker />;

// hold the peace sign ~0.6s to take the photo
useGestureHold({ gesture: "victory", holdMs: 600, onTrigger: takePhoto });
```

- `holdMs: 0` fires on first detection (instant); larger values require a deliberate hold.
- **`armDelayMs` (default 500) is the scene-transition guard.** When a gesture advances to a new scene, the user's hand is often still in that gesture as the next scene mounts — without an arm delay the new scene would fire instantly off the lingering gesture. The default keeps "the next scene doesn't double-fire" working out of the box. Pass `armDelayMs: 0` only if you genuinely want instant-on-mount.
- `enabled: false` gates it without unmounting (e.g. only accept the gesture after a celebration finishes).

```tsx
// Scene A: instant peace-sign advances to Scene B
useGestureHold({ gesture: "victory", holdMs: 0, onTrigger: goToSceneB });

// Scene B: the default arm delay ignores the peace sign that's still up from leaving A
useGestureHold({ gesture: "victory", holdMs: 0, onTrigger: goToSceneC });
```

---

## Capture (photo + video) — from `src/capture.ts`

Trigger-agnostic capture primitives. Wire them to whatever the project uses — a gesture, a click, a timer — the hooks don't care. Both flows return `{ blob, dataUrl }` so previews, downloads, uploads, and shares are all one-line follow-ups.

### `usePhotoCapture()` — single-shot photo from the live R3F render

```tsx
import { usePhotoCapture, saveToDevice } from "../capture";
import { GestureTracker, GestureTrigger } from "@vincentt-xr/sdk/tracking";

const { capture, latest } = usePhotoCapture();

<GestureTracker />
<GestureTrigger
  gestures={["victory"]}
  onTrigger={async () => {
    const photo = await capture();
    saveToDevice(photo, "snap.png");
  }}
/>

// optional preview thumbnail (R3F mesh)
{latest && (
  <ScreenTransform anchors={{ left: 0.4, right: 0.9, top: 0.9, bottom: 0.6 }}>
    <mesh name="thumb">
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={useTexture(latest.dataUrl)} />
    </mesh>
  </ScreenTransform>
)}
```

### `useVideoCapture({ audio? })` — record the live canvas to a video blob

```tsx
import { useVideoCapture, saveToDevice } from "../capture";

const { start, stop, isRecording } = useVideoCapture({ audio: true });

<GestureTrigger gestures={["open_palm"]} onTrigger={() => start()} />
<GestureTrigger gestures={["closed_fist"]} onTrigger={async () => {
  const video = await stop();
  saveToDevice(video, "clip.webm");
}} />
```

`isRecording` is reactive — use it to drive a "● REC" indicator or pulse a UI element while filming. Audio is off by default so kiosk / silent contexts don't surface a mic prompt; pass `{ audio: true }` for mobile capture with sound.

### `saveToDevice(media, filename)` — browser download

Mobile: surfaces the share / save sheet. Desktop: writes to `~/Downloads`. Kiosk contexts usually want to upload `media.blob` to a server instead — skip this helper and `fetch(uploadUrl, { method: "POST", body: media.blob })`.

### `shareMedia(media, opts?)` — native share sheet

Opens the OS share sheet (Instagram / WhatsApp / Messages) on devices that support the Web Share API with files; falls back to a download elsewhere. Returns `{ shared }` so you can branch — e.g. show a "scan to get it on your phone" QR when the native sheet isn't available.

```tsx
import { useVideoCapture, shareMedia } from "../capture";

const { stop } = useVideoCapture();

const video = await stop();
const { shared } = await shareMedia(video, {
  filename: "my-ar-clip.webm",
  title: "My AR clip",
});
if (!shared) {
  // desktop / kiosk: it downloaded instead. Show a QR or upload + display a link.
}
```

For a low-level synchronous alternative, the SDK's `session.captureFrame(): string` returns a raw `data:image/png;base64,...` string. Prefer `usePhotoCapture()` for everything else — it manages the latest preview, returns a `Blob` for uploads, and keeps the photo/video API shapes symmetric.

---

## HTML overlays (QR codes, sharp DOM UI) — from `src/overlay.tsx`

Most chrome (frames, prompts, badges) belongs in the 3D scene via `<ScreenSpaceUI>` (SDK) — it composites with the AR content and tracks correctly. Use HTML overlays only for content that must be pixel-sharp and is awkward in 3D, chiefly **QR codes** (they moire and soften when projected onto a textured plane).

Overlays render as plain DOM positioned over the canvas, inside the portrait frame. They are NOT R3F — use HTML/CSS inside them, not meshes. Place an overlay anywhere in your `Scene.tsx` return; it portals visually above the canvas via absolute positioning.

### `<Overlay corner margin interactive>` — positioned DOM layer

```tsx
import { Overlay, QRCode } from "../overlay";

// "Scan to open on your phone" — kiosk entry point
<Overlay corner="bottom-right" margin={32}>
  <QRCode value="https://myapp.vincentt.app" size={180} />
</Overlay>
```

`corner` is one of `top-left | top-right | bottom-left | bottom-right | center` (default `bottom-right`). `interactive` (default false) lets pointer events through so the overlay never blocks gestures; set it `true` only for a tappable control on a touch kiosk.

### `<QRCode value size light dark padded>` — crisp scannable QR

```tsx
import { usePhotoCapture, shareMedia } from "../capture";
import { Overlay, QRCode } from "../overlay";
import { useState } from "react";

const { capture } = usePhotoCapture();
const [shareUrl, setShareUrl] = useState<string | null>(null);

// after a capture, upload the blob and show a QR to the resulting URL
const onSnap = async () => {
  const photo = await capture();
  const { shared } = await shareMedia(photo, { filename: "snap.png" });
  if (!shared) {
    // desktop/kiosk: upload and surface a QR instead of a download
    const url = await uploadAndGetUrl(photo.blob); // your endpoint
    setShareUrl(url);
  }
};

{shareUrl && (
  <Overlay corner="center">
    <QRCode value={shareUrl} size={220} />
  </Overlay>
)}
```

Renders as SVG (sharp at any size). `padded` (default true) draws a white quiet-zone card so the code stays scannable over a busy camera feed. QR is **display/encode only** — there is no camera-side QR scanning in the template.

### Gotcha: give replaced elements (`<img>`, `<video>`) a sized wrapper

`<Overlay>` bridges out of the canvas via a wrapper that shrink-wraps its content. Text and `<QRCode>` carry their own intrinsic size, so they render fine. A bare `<img>` or `<video>` does **not** — it collapses to ~0px (just its border) and looks invisible. Wrap media in a `div` with explicit `width` + `height`, give it `overflow: hidden`, and let the media fill it:

```tsx
import { usePhotoCapture } from "../capture";
import { Overlay } from "../overlay";

const { latest } = usePhotoCapture();

// preview the last photo, bottom-left
{latest && (
  <Overlay corner="bottom-left" margin={20}>
    <div style={{ width: 110, height: 146, overflow: "hidden", borderRadius: 10, border: "2px solid #fff" }}>
      <img src={latest.dataUrl} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    </div>
  </Overlay>
)}
```

The same applies to a `useVideoCapture()` `latest` preview — wrap the `<video>` in a sized `div`. (To preview captures as a 3D plane instead, use `useTexture(latest.dataUrl)` on a `<mesh>` inside `<ScreenSpaceUI>` — see the capture section.)

---

## Sprite-sheet animation — from `src/sprite.tsx`

A sprite sheet is one image holding a grid of animation frames. Use it for countdowns, animated stickers, mascots, and particle bursts — anything frame-by-frame. Two tiers:

### `<SpriteSheet>` — a single animated sprite (the common case)

A textured plane that cycles through the sheet's cells. Extra mesh props pass through, so it composes in screen-space (inside `<ScreenTransform>`) or world-space (inside `<TrackingAnchor>`) unchanged. Frames read left-to-right, top row first.

```tsx
import { useTexture } from "@react-three/drei";
import { SpriteSheet } from "./sprite";

const sheet = useTexture("https://cdn.../countdown.png"); // a 1x3 sheet: "3","2","1"

// screen-center countdown that plays once
<ScreenTransform anchors={{ left: -0.25, right: 0.25, top: 0.25, bottom: -0.25 }}>
  <SpriteSheet name="countdown" texture={sheet} columns={1} rows={3} fps={1} loop={false} onComplete={snap} />
</ScreenTransform>

// or pinned to the forehead as an animated sticker (4x4 sheet, looping)
<FaceTracker>
  <TrackingAnchor target="face.forehead">
    <SpriteSheet name="sticker" texture={stickerSheet} columns={4} rows={4} fps={12} scale={[0.3, 0.3, 1]} />
  </TrackingAnchor>
</FaceTracker>
```

Props: `texture`, `columns`, `rows`, `fps` (default 12), `loop` (default true), `playing` (default true — gate playback), `frameCount` (default `columns*rows`; set lower if the sheet has blank trailing cells), `onComplete` (fires when a non-looping animation ends). Plus any mesh prop (`name`, `scale`, `position`, `renderOrder`, `opacity`).

### `useSpriteSheet(opts)` — the hook, when you need the raw frame

Returns `{ map, frame, setFrame }`. Apply `map` to your own material; read `frame` for per-frame logic; call `setFrame(i)` to jump/restart. `<SpriteSheet>` is just this hook on a plane.

### `useInstancedSpriteUV({ texture, columns, rows, count })` — sprite particles (advanced)

For many sprites in one draw call (confetti, sparkles). It gives you only the reusable **mechanic** — per-instance UV cell + alpha through a pre-patched material — and you write the spawn/physics loop yourself (particle behavior is always bespoke).

```tsx
import { useInstancedSpriteUV } from "./sprite";

const sprite = useInstancedSpriteUV({ texture: confettiSheet, columns: 4, rows: 4, count: 1500 });

useEffect(() => {
  const g = meshRef.current.geometry;
  g.setAttribute("instanceUvOffset", sprite.uvOffset);
  g.setAttribute("instanceAlpha", sprite.alpha);
}, []);

useFrame((_s, delta) => {
  // your physics: move each instance's matrix, set its cell + alpha
  sprite.setCell(i, cellIndex);          // which sheet cell this instance shows
  sprite.alpha.setX(i, fade);            // per-instance fade
  sprite.alpha.needsUpdate = true;
});

<instancedMesh ref={meshRef} args={[undefined, sprite.material, 1500]}>
  <planeGeometry args={[0.1, 0.1]} />
</instancedMesh>
```

---

## Common patterns

Each pattern names which primitives compose it (SDK components + template helpers). Use as starting points; combine and adapt freely.

### gesture-photo-booth (the canonical photo flow)

- `<GestureTracker />` (SDK) to enable gesture detection
- `<ScreenSpaceUI>` (SDK) overlay with a "do the peace sign" prompt and decorative frame
- `<GestureTrigger gestures={["victory"]} onTrigger={...}>` (SDK) fires the capture (or `useGestureHold` for a debounced hold-to-trigger)
- `usePhotoCapture()` (template) returns the photo; hand to state, download, or share
- Optional: 3-2-1 countdown `<SpriteSheet>` (template) before the capture

### face-decoration (single-scene face effect)

- `<FaceTracker>` wrapping `<TrackingAnchor target="face.forehead">` (SDK) with a 3D mesh/texture
- Optional `<FaceTracker.Mesh />` (SDK) for full deforming face coverage
- No interaction required — the decoration simply follows the face

### hand-effect / body-effect

- `<HandTracker>` or `<BodyTracker>` (SDK) + `<TrackingAnchor target="hand.indexTip">` / `<TrackingAnchor target="body.leftShoulder">`
- 3D objects follow the landmark each frame

### segmentation-background

- `<Segmentation type="portrait" />` (SDK; registers the segmentation pipeline; mounts alongside a state/ref for the mask)
- Pass the resulting mask texture to `<VideoBackground segmentationMask={mask} customBackground={replacementColor} />` (SDK) in App.tsx

### gesture-controlled (no tracker visuals)

- `<GestureTracker>` + `<GestureTrigger>` (SDK) drives effects (particles, scene transitions, animations) without any visible hand/face overlay

---

## Notes

- `VideoBackground`, camera, and lighting are already mounted in `src/App.tsx`. Do NOT add a second background plane — it covers the camera.
- Assets are referenced by **URL** (uploaded-asset or curated-library CDN URLs); read `src/assets/manifest.json` / `src/assets/library-manifest.json` for what's available.
- Tracker components self-register — no `registerXRPipeline` call needed.
- Always name your meshes — `name="..."` enables runtime lookup and visual-feedback editing.
