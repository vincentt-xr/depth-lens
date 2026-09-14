/* eslint-disable react/no-unknown-property */
// Sprite-sheet animation primitives for Scene.tsx.
//
// A sprite sheet is one image holding a grid of animation frames; playback
// windows the texture UVs to one cell at a time. These cover the two tiers
// that AR content actually needs:
//
//   - single sprite  -> useSpriteSheet / <SpriteSheet>  (countdowns, animated
//     stickers, mascots). Drop <SpriteSheet> inside <ScreenTransform> for a
//     screen overlay, or inside <TrackingAnchor> to pin it to a face/hand/body
//     landmark — it's a plain mesh, so it composes either way.
//   - many instances -> useInstancedSpriteUV (confetti / particle bursts). This
//     gives you ONLY the hard, reusable mechanic — per-instance UV cell + alpha
//     fed through one draw call. You write the spawn/physics loop yourself in a
//     useFrame; particle behavior is always bespoke.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import {
  type Texture,
  InstancedBufferAttribute,
  MeshBasicMaterial,
  SRGBColorSpace,
} from "three";

// ---------------------------------------------------------------------------
// Single sprite
// ---------------------------------------------------------------------------

export interface SpriteSheetOptions {
  /** The sheet image. Load with drei's `useTexture("/assets/sheet.png")`. */
  texture: Texture;
  /** Grid columns. */
  columns: number;
  /** Grid rows. */
  rows: number;
  /** Frames per second. Default 12. */
  fps?: number;
  /** Loop when the last frame is reached. Default true. */
  loop?: boolean;
  /** Gate playback without unmounting. Default true. */
  playing?: boolean;
  /**
   * Number of usable cells, if the sheet has blank trailing cells. Defaults to
   * `columns * rows`. Frames are read left-to-right, top row first.
   */
  frameCount?: number;
  /** Fires once when a non-looping animation reaches its last frame. */
  onComplete?: () => void;
}

export interface SpriteSheetState {
  /** Set this as your material's `map`; it's UV-windowed to the current cell. */
  map: Texture;
  /** Current 0-based frame index, for per-frame scene logic. */
  frame: number;
  /** Jump to a frame (also restarts a completed non-looping animation). */
  setFrame: (i: number) => void;
}

// One texture clone per cell, each windowed to its grid cell. Cloning shares
// the GPU image (no extra upload); only the cheap UV transform differs. Row 0
// is the TOP row — texture V is bottom-up, so cell (cx,cy) offsets to
// (cx/cols, 1 - (cy+1)/rows).
const buildFrames = (
  texture: Texture,
  columns: number,
  rows: number,
  frameCount: number,
): Texture[] =>
  Array.from({ length: frameCount }, (_, i) => {
    const cx = i % columns;
    const cy = Math.floor(i / columns);
    const f = texture.clone();
    f.colorSpace = SRGBColorSpace;
    f.repeat.set(1 / columns, 1 / rows);
    f.offset.set(cx / columns, 1 - (cy + 1) / rows);
    f.needsUpdate = true;
    return f;
  });

/**
 * `useSpriteSheet(opts)` — drive a sprite animation; returns the current cell's
 * `map`, the `frame` index, and a `setFrame` control. Apply `map` to any
 * material yourself, or use `<SpriteSheet>` for the common mesh case.
 */
export const useSpriteSheet = ({
  texture,
  columns,
  rows,
  fps = 12,
  loop = true,
  playing = true,
  frameCount,
  onComplete,
}: SpriteSheetOptions): SpriteSheetState => {
  const count = frameCount ?? columns * rows;
  const frames = useMemo(
    () => buildFrames(texture, columns, rows, count),
    [texture, columns, rows, count],
  );

  const frameRef = useRef(0);
  const accRef = useRef(0);
  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Mirror the live frame into state-free render output via a ref the component
  // reads each frame. We expose `frame` as the last-rendered value.
  const stateRef = useRef<SpriteSheetState>({
    map: frames[0],
    frame: 0,
    setFrame: (i: number) => {
      frameRef.current = Math.max(0, Math.min(count - 1, i));
      accRef.current = 0;
      doneRef.current = false;
    },
  });
  // Keep map reference fresh if the frames array was rebuilt (texture swap).
  stateRef.current.map = frames[frameRef.current] ?? frames[0];

  useFrame((_s, delta) => {
    if (!playing || doneRef.current || count <= 1) return;
    accRef.current += delta * fps;
    if (accRef.current < 1) return;
    const advance = Math.floor(accRef.current);
    accRef.current -= advance;
    let next = frameRef.current + advance;
    if (next >= count) {
      if (loop) {
        next %= count;
      } else {
        next = count - 1;
        doneRef.current = true;
        onCompleteRef.current?.();
      }
    }
    frameRef.current = next;
    stateRef.current.frame = next;
    stateRef.current.map = frames[next];
  });

  return stateRef.current;
};

// ---------------------------------------------------------------------------
// Declarative single sprite — works in screen- or world-space
// ---------------------------------------------------------------------------

export type SpriteSheetProps = SpriteSheetOptions &
  Omit<ThreeElements["mesh"], "ref"> & {
    /** Material opacity (the material is always transparent). Default 1. */
    opacity?: number;
  };

/**
 * `<SpriteSheet>` — a textured plane that plays a sprite sheet. All extra mesh
 * props pass through, so it drops into `<ScreenTransform>` (screen overlay) or
 * `<TrackingAnchor>` (pinned to a landmark) unchanged.
 *
 * ```tsx
 * const tex = useTexture("/assets/countdown.png");
 * <ScreenTransform anchors={{ left: -0.3, right: 0.3, top: 0.3, bottom: -0.3 }}>
 *   <SpriteSheet name="countdown" texture={tex} columns={1} rows={3} fps={1} loop={false} />
 * </ScreenTransform>
 * ```
 */
export const SpriteSheet = ({
  texture,
  columns,
  rows,
  fps,
  loop,
  playing,
  frameCount,
  onComplete,
  opacity = 1,
  ...meshProps
}: SpriteSheetProps) => {
  // Hold the live state object — `state.map` is mutated each frame by the hook's
  // useFrame. Reading `state.map` (not a destructured snapshot) inside our own
  // useFrame is what keeps the material in sync with the current cell.
  const state = useSpriteSheet({
    texture,
    columns,
    rows,
    fps,
    loop,
    playing,
    frameCount,
    onComplete,
  });
  const matRef = useRef<MeshBasicMaterial>(null);
  useFrame(() => {
    if (matRef.current && matRef.current.map !== state.map) {
      matRef.current.map = state.map;
      matRef.current.needsUpdate = true;
    }
  });
  return (
    <mesh {...meshProps}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={matRef}
        map={state.map}
        transparent
        opacity={opacity}
        depthTest={false}
      />
    </mesh>
  );
};

// ---------------------------------------------------------------------------
// Instanced sprite mechanic (you own the physics)
// ---------------------------------------------------------------------------

export interface InstancedSpriteUV {
  /**
   * Per-instance UV cell offset. Attach to your InstancedMesh geometry:
   * `geometry.setAttribute("instanceUvOffset", uvOffset)`.
   */
  uvOffset: InstancedBufferAttribute;
  /**
   * Per-instance alpha (0..1). Attach as `instanceAlpha`; set values per frame
   * to fade pieces in/out.
   */
  alpha: InstancedBufferAttribute;
  /** Material pre-patched to sample `uvOffset`'s cell and multiply `instanceAlpha`. */
  material: MeshBasicMaterial;
  /** Point instance `i` at grid `cell` (0-based, left-to-right, top row first). */
  setCell: (i: number, cell: number) => void;
}

/**
 * `useInstancedSpriteUV({ texture, columns, rows, count })` — the reusable
 * mechanic for sprite-sheet particles in a single draw call. Returns the two
 * instanced attributes and a material whose shader samples each instance's cell
 * and applies its alpha.
 *
 * You build the `<instancedMesh>` and write the spawn/gravity/tumble loop in
 * your own `useFrame` (particle behavior is always bespoke). This just removes
 * the fiddly UV-attribute + onBeforeCompile shader plumbing.
 *
 * ```tsx
 * const sprite = useInstancedSpriteUV({ texture: tex, columns: 4, rows: 4, count: 1500 });
 * useEffect(() => { meshRef.current.geometry.setAttribute("instanceUvOffset", sprite.uvOffset);
 *   meshRef.current.geometry.setAttribute("instanceAlpha", sprite.alpha); }, []);
 * // in useFrame: sprite.setCell(i, cell); sprite.alpha.setX(i, a); sprite.alpha.needsUpdate = true;
 * <instancedMesh ref={meshRef} args={[undefined, sprite.material, count]}>
 *   <planeGeometry args={[0.1, 0.1]} />
 * </instancedMesh>
 * ```
 */
export const useInstancedSpriteUV = ({
  texture,
  columns,
  rows,
  count,
}: {
  texture: Texture;
  columns: number;
  rows: number;
  count: number;
}): InstancedSpriteUV => {
  const uvOffset = useMemo(
    () => new InstancedBufferAttribute(new Float32Array(count * 2), 2),
    [count],
  );
  const alpha = useMemo(
    () => new InstancedBufferAttribute(new Float32Array(count).fill(1), 1),
    [count],
  );

  const material = useMemo(() => {
    const t = texture.clone();
    t.colorSpace = SRGBColorSpace;
    // Each instance samples a single cell window; the per-instance offset (set
    // via setCell) shifts that window to the instance's cell.
    t.repeat.set(1 / columns, 1 / rows);
    t.needsUpdate = true;
    const mat = new MeshBasicMaterial({ map: t, transparent: true, depthTest: false });
    // onBeforeCompile mutates the shader object — that's the three.js contract.
    /* eslint-disable no-param-reassign */
    mat.onBeforeCompile = (shader) => {
      const vertHead = `attribute vec2 instanceUvOffset;
attribute float instanceAlpha;
varying vec2 vUvOff;
varying float vAlpha;
`;
      shader.vertexShader = `${vertHead}${shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nvUvOff = instanceUvOffset;\nvAlpha = instanceAlpha;",
      )}`;
      const fragHead = `varying vec2 vUvOff;
varying float vAlpha;
`;
      shader.fragmentShader = `${fragHead}${shader.fragmentShader
        .replace(
          "#include <map_fragment>",
          "vec4 sampledDiffuseColor = texture2D( map, vMapUv + vUvOff );\ndiffuseColor *= sampledDiffuseColor;",
        )
        .replace(
          "#include <opaque_fragment>",
          "gl_FragColor.a *= vAlpha;\n#include <opaque_fragment>",
        )}`;
    };
    /* eslint-enable no-param-reassign */
    return mat;
  }, [texture, columns, rows]);

  const setCell = useCallback(
    (i: number, cell: number) => {
      const cx = cell % columns;
      const cy = Math.floor(cell / columns);
      uvOffset.setXY(i, cx / columns, 1 - (cy + 1) / rows);
      uvOffset.needsUpdate = true;
    },
    [uvOffset, columns, rows],
  );

  // Mark attributes dynamic-ish: nothing to do on mount, but keep the effect to
  // document that callers attach these to their geometry.
  useEffect(() => {
    uvOffset.needsUpdate = true;
    alpha.needsUpdate = true;
  }, [uvOffset, alpha]);

  return { uvOffset, alpha, material, setCell };
};
