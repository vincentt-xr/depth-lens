/**
 * The experience's PUBLIC readiness signal, for whoever embeds it.
 *
 * The shell already reports readiness privately (`reportSession`, to the
 * platform's beacon). A host page framing a published experience had no way to
 * know when it was usable — when to fade its own placeholder, when to start a
 * tutorial, when to show "allow the camera" help — so each embedder invented
 * one. This is the one they can rely on (vincentt-xr/v2-template#117).
 *
 * Three surfaces carry the same value, each for a different consumer:
 *
 *   - `<html data-experience="loading|ready|error">` — for CSS and for a host
 *     that polls `contentDocument` (same-origin embeds only).
 *   - a `window` CustomEvent `experience:status`, detail `{ status, reason? }`
 *     — for script running INSIDE the experience (a creator's own overlay).
 *   - `window.parent.postMessage({ type: "experience:status", status,
 *     reason? }, "*")` — for the host page, cross-origin included. Sent only
 *     when framed; a top-level page has no parent to tell.
 *
 * `"*"` is deliberate: the message carries no secret — a status word and, on
 * error, the SDK's reason enum — and the experience cannot know its embedder's
 * origin. A host should still check `event.source === iframe.contentWindow`
 * before trusting it, which the AGENTS.md snippet shows.
 *
 * Pure and dependency-free: the environment is injected so it is testable, and
 * nothing here touches React or the SDK.
 */

export type ExperienceStatus = "loading" | "ready" | "error";

export type ExperienceStatusMessage = {
  type: "experience:status";
  status: ExperienceStatus;
  /** The SDK's `useXRError().reason` enum, present on `error` only. */
  reason?: string;
};

export const EXPERIENCE_STATUS_EVENT = "experience:status";
export const EXPERIENCE_STATUS_ATTR = "data-experience";

/** `ready` beats `loading`; an error beats both. */
export const deriveExperienceStatus = (ready: boolean, reason?: unknown): ExperienceStatus => {
  if (reason !== undefined && reason !== null) return "error";
  return ready ? "ready" : "loading";
};

export type StatusEnvironment = {
  documentElement?: { setAttribute: (name: string, value: string) => void } | null;
  dispatchEvent?: (event: Event) => boolean;
  /** The parent to post to; `undefined` or the window itself means not framed. */
  parent?: { postMessage: (message: unknown, targetOrigin: string) => void } | null;
  self?: unknown;
};

const defaultEnvironment = (): StatusEnvironment => {
  if (typeof window === "undefined") return {};
  let parent: StatusEnvironment["parent"] = null;
  try {
    parent = window.parent !== window ? window.parent : null;
  } catch {
    parent = null;
  }
  return {
    documentElement: document.documentElement,
    dispatchEvent: (e) => window.dispatchEvent(e),
    parent,
  };
};

/** Writes one status to all three surfaces. Never throws: a hostile parent is not the app's problem. */
export const publishExperienceStatus = (
  status: ExperienceStatus,
  reason?: unknown,
  env: StatusEnvironment = defaultEnvironment(),
): ExperienceStatusMessage => {
  const message: ExperienceStatusMessage = { type: "experience:status", status };
  if (status === "error" && reason !== undefined && reason !== null) message.reason = String(reason);

  try {
    env.documentElement?.setAttribute(EXPERIENCE_STATUS_ATTR, status);
  } catch {
    // A detached document; nothing to mark.
  }
  try {
    env.dispatchEvent?.(
      new CustomEvent(EXPERIENCE_STATUS_EVENT, {
        detail: { status, ...(message.reason ? { reason: message.reason } : {}) },
      }),
    );
  } catch {
    // CustomEvent unavailable; the attribute and the message still went out.
  }
  try {
    env.parent?.postMessage(message, "*");
  } catch {
    // A parent that refuses the message is the host's concern.
  }
  return message;
};
