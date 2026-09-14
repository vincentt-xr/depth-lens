// HTML overlay primitives — DOM UI drawn on top of the live AR canvas.
//
// Most chrome (frames, prompts, badges) belongs in the 3D scene via the
// SDK's ScreenSpaceUI. Use these only for content that must be pixel-sharp
// and is awkward in 3D — chiefly QR codes, which moire and soften when
// projected onto a textured plane.
//
// Scene.tsx renders inside the R3F canvas, where only three.js objects are
// valid — a raw <div> or <svg> there throws "not part of the THREE
// namespace". drei's <Html> is the bridge: it's registered with R3F and
// portals real DOM out to a wrapper over the canvas. <Overlay> wraps it and
// pins the content to a screen corner (via a fixed calculatePosition) so the
// QR stays put regardless of the 3D camera.
import type { CSSProperties, ReactNode } from "react";
import { Html } from "@react-three/drei";
import { QRCodeSVG } from "qrcode.react";

type Corner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center";

// Pin the Html wrapper to a corner of the canvas rect, in screen px. Returning
// a constant from calculatePosition makes the overlay ignore the 3D camera.
const cornerPosition =
  (corner: Corner, margin: number) =>
  (
    _el: unknown,
    _camera: unknown,
    size: { width: number; height: number },
  ): number[] => {
    const { width, height } = size;
    switch (corner) {
      case "top-left":
        return [margin, margin, 0];
      case "top-right":
        return [width - margin, margin, 0];
      case "bottom-left":
        return [margin, height - margin, 0];
      case "bottom-right":
        return [width - margin, height - margin, 0];
      case "center":
        return [width / 2, height / 2, 0];
      default:
        return [0, 0, 0];
    }
  };

// Translate the wrapper so the chosen corner of the content aligns to the
// pinned point (Html anchors content at its top-left by default).
const cornerTransform = (corner: Corner): CSSProperties => {
  switch (corner) {
    case "top-left":
      return { transform: "translate(0, 0)" };
    case "top-right":
      return { transform: "translate(-100%, 0)" };
    case "bottom-left":
      return { transform: "translate(0, -100%)" };
    case "bottom-right":
      return { transform: "translate(-100%, -100%)" };
    case "center":
      return { transform: "translate(-50%, -50%)" };
    default:
      return {};
  }
};

/**
 * `<Overlay corner margin interactive>` — pixel-sharp HTML pinned over the
 * canvas. Render it from inside Scene.tsx; it bridges out of the 3D canvas
 * automatically via drei's <Html>.
 *
 * Children are plain DOM (HTML/CSS), not meshes. Pointer events pass through
 * by default; set `interactive` to capture clicks (a tappable control on a
 * touch kiosk).
 */
export const Overlay = ({
  corner = "bottom-right",
  margin = 24,
  interactive = false,
  children,
}: {
  corner?: Corner;
  margin?: number;
  interactive?: boolean;
  children: ReactNode;
}) => (
  <Html
    calculatePosition={cornerPosition(corner, margin)}
    zIndexRange={[10, 0]}
    pointerEvents={interactive ? "auto" : "none"}
    style={{ ...cornerTransform(corner) }}
  >
    {children}
  </Html>
);

/**
 * `<QRCode value size light dark padded>` — a crisp, scannable QR code.
 *
 * Renders as SVG (sharp at any size). Wrap in `<Overlay>` to place it over
 * the AR feed — e.g. "scan to open on your phone" on a kiosk, or "scan to
 * download your photo" after a capture.
 *
 * `padded` (default true) draws a white quiet-zone card behind the code so
 * it stays scannable over a busy camera background; pass `false` for a bare
 * code on a known-light surface.
 */
export const QRCode = ({
  value,
  size = 160,
  light = "#ffffff",
  dark = "#000000",
  padded = true,
}: {
  value: string;
  size?: number;
  light?: string;
  dark?: string;
  padded?: boolean;
}) => {
  const code = (
    <QRCodeSVG
      value={value}
      size={size}
      bgColor={padded ? "#ffffff" : light}
      fgColor={dark}
      level="M"
    />
  );
  if (!padded) return code;
  return (
    <div
      style={{
        background: "#ffffff",
        padding: 12,
        borderRadius: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
        lineHeight: 0,
      }}
    >
      {code}
    </div>
  );
};
