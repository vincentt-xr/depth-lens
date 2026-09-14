// Preview-only: exposes the live scene's object positions, projected to screen
// space, so the editor's visual-feedback loop can hand the agent GROUND-TRUTH
// "where things currently are on screen" instead of making it eyeball the image.
// Mounted only when VITE_PREVIEW=true; a no-op in published apps.
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Box3, Vector3 } from "three";

export interface SceneAnchor {
  /** The object's `name` (if set), else its type — how the agent correlates it to source. */
  name: string;
  type: string;
  /** Screen-space bounding box as % of the canvas (0=left/top → 100=right/bottom). */
  centerX: number;
  centerY: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** World position, for the agent's scene-unit calibration. */
  world: [number, number, number];
}

declare global {
  interface Window {
    __vincenttGetAnchors?: () => SceneAnchor[];
  }
}

export function PreviewAnchors() {
  const { scene, camera, size } = useThree();

  // `size` is in the deps so the exposed fn is re-bound on resize, even though the
  // NDC projection itself is resolution-independent.
  const sizeKey = `${size.width}x${size.height}`;

  useEffect(() => {
    if (import.meta.env.VITE_PREVIEW !== "true") {
      return undefined;
    }
    window.__vincenttGetAnchors = () => {
      const out: SceneAnchor[] = [];
      const box = new Box3();
      const corner = new Vector3();
      scene.traverse((obj) => {
        // Only annotate "real" content meshes with geometry; skip the camera,
        // lights, helpers, and the framework's background plane.
        const isMesh = (obj as { isMesh?: boolean }).isMesh === true;
        if (!isMesh) {
          return;
        }
        box.setFromObject(obj);
        if (box.isEmpty()) {
          return;
        }

        // Project all 8 corners → screen-space AABB in %.
        const corners: Array<[number, number, number]> = [
          [box.min.x, box.min.y, box.min.z],
          [box.max.x, box.min.y, box.min.z],
          [box.min.x, box.max.y, box.min.z],
          [box.max.x, box.max.y, box.min.z],
          [box.min.x, box.min.y, box.max.z],
          [box.max.x, box.min.y, box.max.z],
          [box.min.x, box.max.y, box.max.z],
          [box.max.x, box.max.y, box.max.z],
        ];
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        corners.forEach(([cx, cy, cz]) => {
          corner.set(cx, cy, cz).project(camera); // → NDC [-1, 1]
          const xPct = ((corner.x + 1) / 2) * 100;
          const yPct = ((1 - corner.y) / 2) * 100; // flip: NDC +y up, screen y down
          minX = Math.min(minX, xPct);
          minY = Math.min(minY, yPct);
          maxX = Math.max(maxX, xPct);
          maxY = Math.max(maxY, yPct);
        });
        const world = new Vector3();
        obj.getWorldPosition(world);
        out.push({
          name: obj.name || `(unnamed ${obj.type})`,
          type: obj.type,
          centerX: Math.round((minX + maxX) / 2),
          centerY: Math.round((minY + maxY) / 2),
          minX: Math.round(minX),
          minY: Math.round(minY),
          maxX: Math.round(maxX),
          maxY: Math.round(maxY),
          world: [
            Number(world.x.toFixed(2)),
            Number(world.y.toFixed(2)),
            Number(world.z.toFixed(2)),
          ],
        });
      });
      return out;
    };
    return () => {
      delete window.__vincenttGetAnchors;
    };
  }, [scene, camera, sizeKey]);

  return null;
}
