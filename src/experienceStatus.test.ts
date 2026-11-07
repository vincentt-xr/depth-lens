import { describe, expect, it, vi } from "vitest";

import {
  EXPERIENCE_STATUS_ATTR,
  EXPERIENCE_STATUS_EVENT,
  deriveExperienceStatus,
  publishExperienceStatus,
} from "./experienceStatus";

describe("deriveExperienceStatus", () => {
  it("is loading until ready, ready once ready, error whenever a reason exists", () => {
    expect(deriveExperienceStatus(false)).toBe("loading");
    expect(deriveExperienceStatus(true)).toBe("ready");
    expect(deriveExperienceStatus(false, "permission-denied")).toBe("error");
    // An error after ready is still an error: a camera lost mid-session.
    expect(deriveExperienceStatus(true, "camera-lost")).toBe("error");
    expect(deriveExperienceStatus(true, null)).toBe("ready");
  });
});

const fakeEnv = (framed: boolean) => {
  const setAttribute = vi.fn<(name: string, value: string) => void>();
  const dispatchEvent = vi.fn<(event: Event) => boolean>(() => true);
  const postMessage = vi.fn<(message: unknown, targetOrigin: string) => void>();
  return {
    env: {
      documentElement: { setAttribute },
      dispatchEvent,
      parent: framed ? { postMessage } : null,
    },
    setAttribute,
    dispatchEvent,
    postMessage,
  };
};

describe("publishExperienceStatus", () => {
  it("writes the attribute, dispatches the event and posts to the parent when framed", () => {
    const { env, setAttribute, dispatchEvent, postMessage } = fakeEnv(true);
    const msg = publishExperienceStatus("ready", undefined, env);
    expect(msg).toEqual({ type: "experience:status", status: "ready" });
    expect(setAttribute).toHaveBeenCalledWith(EXPERIENCE_STATUS_ATTR, "ready");
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe(EXPERIENCE_STATUS_EVENT);
    expect(event.detail).toEqual({ status: "ready" });
    expect(postMessage).toHaveBeenCalledWith({ type: "experience:status", status: "ready" }, "*");
  });

  it("carries the SDK reason on error only", () => {
    const { env, postMessage, dispatchEvent } = fakeEnv(true);
    publishExperienceStatus("error", "permission-denied", env);
    expect(postMessage).toHaveBeenCalledWith(
      { type: "experience:status", status: "error", reason: "permission-denied" },
      "*",
    );
    expect((dispatchEvent.mock.calls[0][0] as CustomEvent).detail).toEqual({
      status: "error",
      reason: "permission-denied",
    });
    // A reason passed with a non-error status is dropped, so a stale reason
    // never rides along on "ready".
    expect(publishExperienceStatus("ready", "permission-denied", env)).toEqual({
      type: "experience:status",
      status: "ready",
    });
  });

  it("does not post when there is no parent", () => {
    const { env, postMessage, setAttribute } = fakeEnv(false);
    publishExperienceStatus("loading", undefined, env);
    expect(postMessage).not.toHaveBeenCalled();
    expect(setAttribute).toHaveBeenCalledWith(EXPERIENCE_STATUS_ATTR, "loading");
  });

  it("survives a parent that throws", () => {
    const env = {
      documentElement: { setAttribute: vi.fn() },
      dispatchEvent: vi.fn(() => true),
      parent: {
        postMessage: () => {
          throw new Error("SecurityError");
        },
      },
    };
    expect(() => publishExperienceStatus("ready", undefined, env)).not.toThrow();
  });

  it("uses the real window by default: attribute on <html>, event on window", () => {
    const seen: unknown[] = [];
    const onStatus = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(EXPERIENCE_STATUS_EVENT, onStatus);
    publishExperienceStatus("ready");
    window.removeEventListener(EXPERIENCE_STATUS_EVENT, onStatus);
    expect(document.documentElement.getAttribute(EXPERIENCE_STATUS_ATTR)).toBe("ready");
    expect(seen).toEqual([{ status: "ready" }]);
  });
});
