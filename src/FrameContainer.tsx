// FrameContainer.tsx — sizes the app per `frame.config.ts`. Protected shell.
//
// "phone" (default): a fixed 9:16 box centred on a dark ground (the SDK's
// AspectRatioContainer behaviour, owned here so the template can switch it).
// "full": one box the size of the visual viewport, so the canvas is the page.
// `100dvh` follows the mobile browser chrome as it shows and hides.
// Children are absolutely positioned inside either box.
import { useEffect, useState, type ReactNode } from "react";

import { frame, type FrameMode } from "./frame.config";

const ASPECT_W = 9;
const ASPECT_H = 16;

const phoneSize = () => {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  if (vw / vh > ASPECT_W / ASPECT_H) {
    return { width: (vh * ASPECT_W) / ASPECT_H, height: vh };
  }
  return { width: vw, height: (vw * ASPECT_H) / ASPECT_W };
};

export const FrameContainer = ({
  mode = frame,
  children,
}: {
  mode?: FrameMode;
  children: ReactNode;
}) => {
  const [size, setSize] = useState(() =>
    typeof window === "undefined" ? { width: 0, height: 0 } : phoneSize(),
  );

  useEffect(() => {
    const measure = () => setSize(phoneSize());
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  if (mode === "full") {
    return (
      <div
        data-frame="full"
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100dvh",
          overflow: "hidden",
          backgroundColor: "#0d0d0d",
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      data-frame="phone"
      style={{
        width: "100vw",
        height: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        backgroundColor: "#0d0d0d",
      }}
    >
      <div style={{ width: size.width, height: size.height, position: "relative" }}>
        {children}
      </div>
    </div>
  );
};
