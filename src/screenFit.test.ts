import { resolveScreenTransform2D } from "@vincentt-xr/sdk";
import { describe, expect, it } from "vitest";

import { feedRectToScreen, screenSizeScale } from "./screenFit";

const rect = { minX: 0.25, minY: 0.25, maxX: 0.75, maxY: 0.75 };

/** Where the SDK renders the transform, in viewport pixels (top-left origin). */
const rendered = (
  transform: ReturnType<typeof feedRectToScreen>,
  viewport: { width: number; height: number },
) => {
  // The ScreenSpaceUI plane keeps the viewport's ratio, so resolving against
  // the viewport in pixels gives the on-screen rectangle directly.
  const r = resolveScreenTransform2D({
    transform: {
      enabled: true,
      ...transform,
      pivot: [0.5, 0.5],
      rotation: 0,
      scale2D: { x: 1, y: 1 },
      referencePixelsPerUnit: 32,
      renderOrder: 0,
      overlay: true,
      visible: true,
      showTransformGuides: false,
    },
    parentSize: viewport,
  });
  return {
    left: viewport.width / 2 + r.center[0] - r.size[0] / 2,
    top: viewport.height / 2 - r.center[1] - r.size[1] / 2,
    width: r.size[0],
    height: r.size[1],
  };
};

describe("feedRectToScreen", () => {
  it("at 9:16 draws the feed rectangle exactly where it is", () => {
    const viewport = { width: 360, height: 640 };
    const box = rendered(feedRectToScreen(rect, viewport), viewport);
    expect(box.left).toBeCloseTo(90);
    expect(box.top).toBeCloseTo(160);
    expect(box.width).toBeCloseTo(180);
    expect(box.height).toBeCloseTo(320);
  });

  it("on a wide canvas an off-centre face stays on the face", () => {
    const viewport = { width: 1662, height: 960 };
    const face = { minX: 0.8, minY: 0.1, maxX: 0.95, maxY: 0.4 };
    const box = rendered(feedRectToScreen(face, viewport), viewport);
    expect(box.left).toBeCloseTo(0.8 * 1662);
    expect(box.top).toBeCloseTo(0.1 * 960);
    expect(box.width).toBeCloseTo(0.15 * 1662);
    expect(box.height).toBeCloseTo(0.3 * 960);
  });

  it("on a narrow tall canvas the same holds", () => {
    const viewport = { width: 521, height: 958 };
    const face = { minX: 0, minY: 0.3, maxX: 0.3, maxY: 0.6 };
    const box = rendered(feedRectToScreen(face, viewport), viewport);
    expect(box.left).toBeCloseTo(0);
    expect(box.top).toBeCloseTo(0.3 * 958, 0);
    expect(box.width).toBeCloseTo(0.3 * 521, 0);
  });

  it("the uniform scale is the smaller axis ratio", () => {
    expect(screenSizeScale({ width: 1280, height: 720 })).toBeCloseTo(720 / 1280);
    expect(screenSizeScale({ width: 360, height: 640 })).toBeCloseTo(0.5);
  });

  it("pads every side in design pixels", () => {
    const viewport = { width: 360, height: 640 };
    const { size } = feedRectToScreen(rect, viewport, 10);
    expect(size.width).toBeCloseTo(380);
    expect(size.height).toBeCloseTo(660);
  });

  it("survives a zero viewport", () => {
    expect(feedRectToScreen(rect, { width: 0, height: 0 })).toEqual({
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    });
  });
});
