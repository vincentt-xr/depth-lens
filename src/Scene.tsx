/* eslint-disable react/no-unknown-property */
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  ScreenSpaceUI,
  ScreenText,
  XRModel,
  type ScreenTransform2DSettings,
} from "@vincentt-xr/sdk";
import { HandTracker } from "@vincentt-xr/sdk/tracking";
import {
  useXRCameraTexture,
  useXRModelNode,
  type XRModelNodeHandTracking,
} from "@vincentt-xr/sdk/low-level";

type HandPoint = { x: number; y: number; z: number; area: number; gesture?: "closed_fist" | "open_palm" };
type LensSignal = {
  active: boolean;
  strength: number;
  focusX: number;
  focusY: number;
  depth: number;
  jitter: number;
};

const EMPTY_SIGNAL: LensSignal = {
  active: false,
  strength: 0,
  focusX: 0,
  focusY: 0,
  depth: 0,
  jitter: 0,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const damp = (current: number, target: number, lambda: number, delta: number) =>
  THREE.MathUtils.damp(current, target, lambda, delta);

const centerOf = (coordinates?: Array<{ x: number; y: number; z?: number }>): HandPoint | undefined => {
  if (!coordinates?.length) return undefined;
  const xs = coordinates.map((point) => point.x);
  const ys = coordinates.map((point) => point.y);
  const point = coordinates[9] ?? coordinates[0];
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return { x: point.x, y: point.y, z: point.z ?? 0, area: width * height };
};

const getHand = (node: XRModelNodeHandTracking | null) => {
  let hands = node?.hands ?? [];
  if (!hands.length && node?.coordinates) {
    hands = [{ coordinates: node.coordinates, handedness: node.handedness }];
  }
  const hand = hands[0];
  const point = centerOf(hand?.coordinates);
  return point ? { ...point, gesture: hand?.gesture } : undefined;
};

const CAMERA_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CAMERA_FRAGMENT_SHADER = `
  uniform sampler2D cameraTexture;
  uniform float strength;
  uniform vec2 focus;
  uniform float jitter;
  uniform float time;
  varying vec2 vUv;
  vec3 linearToSrgb(vec3 value) {
    return pow(max(value, vec3(0.0)), vec3(1.0 / 2.2));
  }
  vec3 srgbToLinear(vec3 value) {
    return pow(max(value, vec3(0.0)), vec3(2.2));
  }
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  vec2 glitchCorner(vec2 uv, vec2 corner, float amount) {
    vec2 delta = uv - corner;
    float dist = length(delta);
    float gate = smoothstep(0.62, 0.04, dist);
    float bands = step(0.5, fract((uv.y + uv.x * 0.35) * 22.0 + amount * 6.0));
    float slices = step(0.68, fract(uv.y * 90.0 + amount * 11.0));
    float ripple = sin(dist * 45.0 - amount * 18.0) * 0.0025 * amount;
    vec2 dir = normalize(delta + vec2(0.0001));
    vec2 jagged = vec2(
      (hash(vec2(floor(uv.y * 64.0), floor(amount * 8.0))) - 0.5) * 0.015,
      (hash(vec2(floor(uv.x * 32.0), floor(amount * 11.0))) - 0.5) * 0.010
    );
    return uv + (dir * (0.01 + amount * 0.02) + jagged) * gate * (bands * 0.9 + slices * 0.7) + dir * ripple;
  }
  void main() {
    vec2 delta = vUv - focus;
    float centerFalloff = smoothstep(0.78, 0.0, length(delta));
    float cornerWeight =
      max(
        smoothstep(0.85, 0.0, distance(vUv, vec2(0.0, 0.0))),
        smoothstep(0.85, 0.0, distance(vUv, vec2(1.0, 0.0)))
      );
    cornerWeight = max(
      cornerWeight,
      max(
        smoothstep(0.85, 0.0, distance(vUv, vec2(0.0, 1.0))),
        smoothstep(0.85, 0.0, distance(vUv, vec2(1.0, 1.0)))
      )
    );
    float activity = clamp(strength * 1.25 + jitter * 0.75, 0.0, 1.0);
    float glitchNoise = hash(vec2(floor(vUv.x * 38.0), floor(vUv.y * 28.0) + floor(time * 12.0)));
    float tearBand = step(0.72, hash(vec2(floor(vUv.y * 26.0), floor(time * 9.0)))) * activity;
    float tear = (glitchNoise - 0.5) * 0.09 * tearBand;
    vec2 glitchUv = vUv + vec2(tear, 0.0);
    float focusDistance = length(delta * vec2(1.0, 1.35));
    float ringRadius = 0.16 + fract(time * 0.22) * 0.42;
    float ring = smoothstep(0.035, 0.0, abs(focusDistance - ringRadius));
    ring *= smoothstep(0.72, 0.0, ringRadius) * activity;
    float glitch = cornerWeight * activity;
    vec2 cornerAnchor = mix(vec2(1.0, 0.0), vec2(1.0, 1.0), step(0.5, focus.y));
    cornerAnchor = mix(cornerAnchor, vec2(0.0, 0.0), step(0.5, focus.x));
    vec2 warpedUv = glitchCorner(vUv, cornerAnchor, activity);
    vec2 radialFromFist = normalize(delta + vec2(0.0001));
    vec2 centerShift = radialFromFist * centerFalloff * activity * 0.008;
    vec2 edgeDistance = min(vUv, 1.0 - vUv);
    float edgeBlur = 1.0 - smoothstep(0.08, 0.42, min(edgeDistance.x, edgeDistance.y));
    float blur = edgeBlur * (0.004 + activity * 0.028);
    vec2 chroma = vec2(0.0035, 0.0) * glitch;
    vec2 glitchWarpedUv = glitchCorner(glitchUv, cornerAnchor, activity * 0.8);
    vec3 sharp = linearToSrgb(texture2D(cameraTexture, glitchWarpedUv).rgb);
    vec3 base = linearToSrgb(texture2D(cameraTexture, glitchWarpedUv + centerShift).rgb);
    vec3 red = linearToSrgb(texture2D(cameraTexture, glitchWarpedUv + centerShift + chroma).rgb);
    vec3 blue = linearToSrgb(texture2D(cameraTexture, glitchWarpedUv + centerShift - chroma).rgb);
    vec3 color = mix(sharp, vec3(red.r, base.g, blue.b), glitch);
    for (int i = 1; i < 5; i++) {
      float t = float(i) / 4.0;
      vec2 offset = radialFromFist * blur * t;
      vec3 blurSampleA = linearToSrgb(texture2D(cameraTexture, glitchWarpedUv - offset).rgb);
      vec3 blurSampleB = linearToSrgb(texture2D(cameraTexture, glitchWarpedUv + offset).rgb);
      color = mix(color, (blurSampleA + blurSampleB) * 0.5, edgeBlur * (0.16 + activity * 0.12));
    }
    float scan = step(0.5, fract((vUv.y + activity * 0.03) * 120.0));
    float pulse = 0.85 + glitch * 0.25 + scan * glitch * 0.15;
    color.r += glitch * 0.35 * pulse;
    color.b += glitch * 0.55 * pulse;
    color.g *= 1.0 - glitch * 0.18;
    color += vec3(0.0, 0.03, 0.08) * glitch * (1.0 - vUv.x);
    color += vec3(0.10, 0.0, 0.0) * glitch * vUv.y;
    float scanline = step(0.52, fract(vUv.y * 180.0 + time * 3.0));
    float blockNoise = step(0.78, glitchNoise) * activity;
    color *= 1.0 - scanline * activity * 0.18;
    color += vec3(0.20, 0.02, 0.30) * blockNoise;
    color += vec3(0.02, 0.18, 0.35) * tearBand;
    color += vec3(0.08, 0.42, 0.95) * ring;
    color += vec3(0.20, 0.03, 0.45) * ring * (0.5 + 0.5 * sin(time * 8.0));
    color = mix(color, color.bgr, glitch * 0.08);
    gl_FragColor = vec4(srgbToLinear(clamp(color, 0.0, 1.0)), 1.0);
  }
`;

const HandDrivenLens = () => {
  const node = useXRModelNode<XRModelNodeHandTracking>(XRModel.HAND_TRACKER);
  const cameraTexture = useXRCameraTexture();
  const { camera, viewport } = useThree();
  const signal = useRef<LensSignal>({ ...EMPTY_SIGNAL });
  const cameraMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const cameraPlaneRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    const hand = getHand(node);
    const isFist = hand?.gesture === "closed_fist";
    const targetStrength = isFist ? clamp01((hand!.area - 0.025) / 0.18) : 0;
    const next = signal.current;
    next.active = Boolean(isFist);
    next.strength = damp(next.strength, targetStrength, 7, delta);
    next.focusX = damp(next.focusX, isFist ? hand!.x : 0, 8, delta);
    next.focusY = damp(next.focusY, isFist ? hand!.y : 0, 8, delta);
    next.depth = damp(next.depth, isFist ? targetStrength : 0, 6, delta);
    next.jitter = damp(next.jitter, next.active ? 1 : 0, 5, delta);

    if (cameraPlaneRef.current) {
      const planeViewport = viewport.getCurrentViewport(camera, new THREE.Vector3(0, 0, -1));
      cameraPlaneRef.current.scale.set(planeViewport.width / 2, planeViewport.height / 2, 1);
      const elapsed = cameraMaterialRef.current?.uniforms.time.value ?? 0;
      const shake = next.jitter * (0.004 + next.strength * 0.012);
      cameraPlaneRef.current.position.x = Math.sin(elapsed * 31.0) * shake;
      cameraPlaneRef.current.position.y = Math.cos(elapsed * 37.0) * shake * 0.7;
      cameraPlaneRef.current.rotation.z = Math.sin(elapsed * 23.0) * next.jitter * 0.006;
    }
    if (cameraMaterialRef.current) {
      cameraMaterialRef.current.uniforms.time.value += delta;
      cameraMaterialRef.current.uniforms.strength.value = next.strength;
      cameraMaterialRef.current.uniforms.jitter.value = next.jitter;
      cameraMaterialRef.current.uniforms.focus.value.set(
        (next.focusX + 1) / 2,
        (1 - next.focusY) / 2,
      );
    }

  });

  return (
    cameraTexture ? (
      <mesh
        ref={cameraPlaneRef}
        position={[0, 0, -0.98]}
        scale={[
          viewport.getCurrentViewport(camera, new THREE.Vector3(0, 0, -1)).width / 2,
          viewport.getCurrentViewport(camera, new THREE.Vector3(0, 0, -1)).height / 2,
          1,
        ]}
        renderOrder={-999}
      >
        <planeGeometry args={[2, 2]} />
        <shaderMaterial
          ref={cameraMaterialRef}
          uniforms={{
            cameraTexture: { value: cameraTexture },
            strength: { value: 0 },
            focus: { value: new THREE.Vector2(0.5, 0.5) },
            jitter: { value: 0 },
            time: { value: 0 },
          }}
          vertexShader={CAMERA_VERTEX_SHADER}
          fragmentShader={CAMERA_FRAGMENT_SHADER}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    ) : null
  );
};

const INTRO_TRANSFORM: ScreenTransform2DSettings = {
  enabled: true,
  position: { x: 0, y: -500 },
  size: { width: 660, height: 140 },
  pivot: [0.5, 0.5],
  rotation: 0,
  scale2D: { x: 1, y: 1 },
  referencePixelsPerUnit: 32,
  renderOrder: 1000,
  overlay: true,
  visible: true,
  showTransformGuides: false,
};

const Intro = () => (
    <ScreenSpaceUI>
      <ScreenText
        name="depthLensHint"
        text="Clench to trigger the glitch"
        screenTransform={INTRO_TRANSFORM}
        textAlign="center"
        verticalAlign="center"
        fontSize={72}
        resolution={140}
        bgFit="full"
        bgColor="rgba(7, 20, 31, 0.72)"
      />
    </ScreenSpaceUI>
  );

export const Scene = () => (
  <>
    <HandTracker targetFps={24} />
    <HandDrivenLens />
    <Intro />
  </>
);
