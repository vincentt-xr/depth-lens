# Agent instructions for this Vincentt XR project

You are building a real WebXR/AR app locally with the Vincentt XR SDK
(`@vincentt-xr/sdk`) — a React + react-three-fiber app bundled by esbuild. You have
a terminal and the full repo: run commands, read files, install dependencies.

## Start here

**This project is already a complete, runnable AR starter.** It previews and builds
as-is. If you just scaffolded it, your job is not to invent an app — it is to get
the developer to the point where they can describe what they want.

- If the developer has **not** told you what to build yet: confirm the project is
  ready (`pnpm dev` serves; `pnpm build` passes), tell them so, and ask what they
  want to make. **Do not build a scene or pick an idea for them.**
- Read the SDK reference (`GROUNDING.md`) **when you start building a scene**, not
  before. There is no need to read the whole API up front just to confirm the
  starter works.
- Once they describe the app, then design and build it against `GROUNDING.md`.

## The dev loop

- **`pnpm install`** — install dependencies.
- **`pnpm dev`** — esbuild dev server on `http://localhost:5173`.
- **`pnpm preview`** — on-device preview. Builds and serves the app behind a secure
  Cloudflare tunnel so you get one `https` URL to open on a phone. AR needs a secure
  context for camera access, so this is how you test tracking and gestures on a real
  device. Needs `cloudflared` (the harness provisions it automatically if it isn't on
  `PATH`).
- **`pnpm typecheck`** — `tsc --noEmit`.
- **`pnpm build`** — production bundle to `dist/`.

## Platform commands (`vincentt`)

The local-first dev loop is driven by the **`vincentt` CLI** over your shell — no MCP
registration is needed. Invoke it as **`npx vincentt <verb>`** (the CLI is a project
devDep, so this resolves to the local copy — no global install required). If the
developer isn't signed in yet, the first verb opens a browser for them to approve
(the one human step); the token then lives in `~/.vincentt/config.json` and later
verbs run without prompting.

- **`npx vincentt create`** — bind this directory to a backend project (scaffolds the
  starter into an empty dir). Writes `.vincentt/project.json`. Usually already done.
- **`npx vincentt publish`** — build first (`pnpm build`), then this uploads the built
  `dist/` and returns the live `<slug>.vincentt.app` URL. Nothing installs or builds
  server-side; publishing moves the bytes you built locally.
- **`npx vincentt logs` / `network` / `trace`** — read what the phone reported to the
  preview relay: console (add `--errors` to filter), fetch/XHR, performance samples.
  Add `--json` for machine-readable output. Use these to debug on-device misbehavior
  instead of guessing.
- **`npx vincentt feedback --wait`** — block for the next annotation the developer draws
  on the phone preview (a screenshot + strokes/pins + a message), print it as JSON, and
  exit. Loop on it (or self-schedule) to pick up on-device feedback hands-free.

`pnpm preview` (above) is the one loop step that is not a `vincentt` verb — run it in the
background; it holds the secure tunnel open until stopped.

## What you edit

- **`src/Scene.tsx`** — the scene. This is your primary surface. Add SDK components,
  R3F primitives, animation, and state here.
- **Any new file you create under `src/`** — utility hooks, sub-components, asset
  imports. Organize freely.
- **`package.json` dependencies** — add a dependency, then `pnpm install` it yourself.

## What to leave alone

These are the app's shell and helper library. Import from them; don't usually modify
them (this is a convention, not an enforced guard — change one only if a task genuinely
requires it, and know why).

- **`src/App.tsx`** — the runtime shell: XR session start, media-source binding,
  camera, lighting, scene mount.
- **`src/main.tsx`** — the mount.
- **`src/capture.ts`** — capture + share primitives (`usePhotoCapture`,
  `useVideoCapture`, `saveToDevice`, `shareMedia`).
- **`src/overlay.tsx`** — HTML overlay primitives (`<Overlay>`, `<QRCode>`) for
  pixel-sharp DOM UI over the canvas.
- **`src/sprite.tsx`** — sprite-sheet animation (`useSpriteSheet`, `<SpriteSheet>`,
  `useInstancedSpriteUV`).
- **`src/gesture.ts`** — gesture helpers (`useGestureHold`).
- **`src/PreviewAnchors.tsx`** and the build config (`esbuild.config.mjs`,
  `tsconfig*.json`).

The helper APIs (`capture`, `overlay`, `sprite`, `gesture`) are documented in
`GROUNDING.md` — import and use them, don't re-implement them.

## The SDK API lives in GROUNDING.md

`GROUNDING.md` (repo root) is the authoritative reference for every SDK component,
hook, and prop you may use (`<FaceTracker>`, `<HandTracker>`, `<TrackingAnchor>`,
screen-space layout, `<TextLabel>`, `<Panel>`, the capture/overlay/sprite helpers, and
the common patterns). Read it when you begin a scene (not before), and use the
components and props it documents; don't invent props.

Imports:

- Core components and hooks come from **`@vincentt-xr/sdk`**.
- **Trackers** (`FaceTracker`, `HandTracker`, `BodyTracker`, `GestureTracker`,
  `GestureTrigger`, `TrackingAnchor`, `FaceMesh`) come from **`@vincentt-xr/sdk/tracking`**
  — not core. Importing them from `@vincentt-xr/sdk` fails with "no exported member".
- The low-level XR context hooks (`useXRContext`, `useXRReady`, `useXRError`) come from
  **`@vincentt-xr/sdk/low-level`**.

`GROUNDING.md` shows the exact import for each API. You *can* read `node_modules`, but
prefer `GROUNDING.md` — the published `.d.ts` types can lag or omit props, and the
bundle is minified. If something you need isn't in `GROUNDING.md` and isn't clearly in
the types, ask rather than guessing a prop into existence.

## Assets

Reference media by path or URL — there is no upload step.

- **Local files under `public/`** — reference by absolute path (e.g.
  `<img src="/images/logo.svg">`, `useTexture("/textures/wall.jpg")`). The dev server
  serves `public/` at the root and the build copies it into `dist/`.
- **Hosted assets** — reference any absolute URL directly (`useTexture(url)`,
  `<img src={url}>`, `new Audio(url)`). For textures, prefer a downscaled WebP when one
  is available, to save bandwidth.

## Communicating

You are working with a developer, not a non-technical user. Be concise and specific —
component names, props, and file paths are welcome, not something to hide. When you
finish a change, say what you changed and how to check it: for anything camera- or
AR-related, that usually means `pnpm preview` on a phone.
