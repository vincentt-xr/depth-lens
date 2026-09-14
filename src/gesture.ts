// Gesture helpers for Scene.tsx.
//
// The SDK's <GestureTrigger> is one-shot (fires once per recognition event).
// useGestureHold adds the *hold-to-trigger* pattern — fire after the gesture
// has been held for `holdMs`, debounced so a single misclassified frame can't
// latch it. This is the natural fit for "hold peace sign to take the photo" or
// "hold open palm to advance".
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";

import { XRModel } from "@vincentt-xr/sdk";
import { useXRContext } from "@vincentt-xr/sdk/low-level";

export interface GestureHoldOptions {
  /** Gesture name to wait for, e.g. "victory", "open_palm", "thumbs_up". */
  gesture: string;
  /** Hold duration before firing. `0` = fire on first detection (instant). Default 600. */
  holdMs?: number;
  /**
   * Ignore the gesture for this long after mount / re-arm. Defaults to 500ms.
   *
   * This is the scene-transition guard: when a gesture advances to a new
   * scene, the user's hand is often still in that gesture as the next scene
   * mounts. Without an arm delay the new scene's hook would fire instantly off
   * the lingering gesture. The default keeps "next scene doesn't double-fire"
   * working out of the box; pass `0` if you genuinely want instant-on-mount.
   */
  armDelayMs?: number;
  /** Gate the hook without unmounting it (e.g. only after a celebration). Default true. */
  enabled?: boolean;
  /** Fires once when the hold completes. Re-arms after the gesture is released. */
  onTrigger: () => void;
}

/**
 * `useGestureHold({ gesture, holdMs, armDelayMs, enabled, onTrigger })`
 *
 * Polls the gesture tracker each frame; when `gesture` has been held
 * continuously for `holdMs` (after the `armDelayMs` window), calls
 * `onTrigger` once. Releasing the gesture re-arms it for the next hold.
 *
 * Requires a `<GestureTracker />` mounted somewhere in the scene (it registers
 * the model this reads).
 */
export const useGestureHold = ({
  gesture,
  holdMs = 600,
  armDelayMs = 500,
  enabled = true,
  onTrigger,
}: GestureHoldOptions): void => {
  const { session } = useXRContext();

  const heldMsRef = useRef(0);
  const firedRef = useRef(false);
  const armedAtRef = useRef<number | null>(null);
  // Keep the latest callback without re-arming the timer every render.
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  // (Re)arm whenever the hook is enabled. Disabling clears the arm clock so the
  // delay restarts the next time it's enabled.
  useEffect(() => {
    if (enabled) {
      armedAtRef.current = null; // stamped on the first frame (no Date.now at module scope)
      heldMsRef.current = 0;
      firedRef.current = false;
    } else {
      armedAtRef.current = null;
    }
  }, [enabled, gesture]);

  useFrame((_state, delta) => {
    if (!enabled) return;

    // Stamp the arm time on the first active frame, then count from there.
    if (armedAtRef.current === null) {
      armedAtRef.current = 0;
    } else {
      armedAtRef.current += delta * 1000;
    }
    if (armedAtRef.current < armDelayMs) return;

    const node = session.getModelNode<{ gesture?: string }>(
      XRModel.GESTURE_TRACKER,
    );
    const current = node?.gesture?.toLowerCase();

    if (current === gesture.toLowerCase()) {
      // Still firing from a previous hold that hasn't been released yet —
      // don't re-fire on the same continuous hold.
      if (firedRef.current) return;
      heldMsRef.current += delta * 1000;
      if (heldMsRef.current >= holdMs) {
        firedRef.current = true;
        onTriggerRef.current();
      }
    } else {
      // Released (or never matched) — reset the hold and re-arm so the next
      // hold of the gesture fires again.
      heldMsRef.current = 0;
      firedRef.current = false;
    }
  });
};
