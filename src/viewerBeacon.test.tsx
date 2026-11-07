// The shell's beacon wiring. The subject is the CALL SITE, not the beacon: that
// the never-edited shell mounts it once, feeds it the SDK's session state, and
// unmounts it cleanly.
//
// WHAT IS AND IS NOT MOCKED, because it decides what this suite can prove:
//   - `@vincentt-xr/analytics` is NOT mocked. The mount and the session feed go
//     through the real package, so the argument shape asserted here is the shape
//     the package actually accepts. A hand-written fake would assert this repo's
//     GUESS at another package's surface and stay green while the two drifted.
//   - the SDK's session hooks ARE faked. `useXRReady` and `useXRError` are what
//     this suite VARIES to drive the wiring; the SDK producing them correctly is
//     the SDK's own suite.
//
// The beacon is inert off a published address and jsdom runs on `localhost`, so
// nothing is sent here BY DESIGN. That is what makes the mount safe to assert
// without a network seam: the property under test is that the shell wires it and
// survives, not that a request leaves.

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Shell } from "./App";

const { mountViewerBeacon, reportSession, unmount } = vi.hoisted(() => ({
  mountViewerBeacon: vi.fn<() => () => void>(),
  reportSession: vi.fn<(s: { ready: boolean; reason?: unknown }) => void>(),
  unmount: vi.fn<() => void>(),
}));

// The real package is loaded and its exports are spied THROUGH, so the calls
// recorded here are the calls it really received.
vi.mock("@vincentt-xr/analytics", async (importOriginal) => {
  const real = await importOriginal<typeof import("@vincentt-xr/analytics")>();
  return {
    ...real,
    mountViewerBeacon: mountViewerBeacon.mockImplementation(() => {
      const off = real.mountViewerBeacon();
      return () => {
        off();
        unmount();
      };
    }),
    reportSession: reportSession.mockImplementation(real.reportSession),
  };
});

let ready = false;
let reason: string | undefined;

const SESSION = {
  session: {
    setMediaSource: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
  },
};

vi.mock("@vincentt-xr/sdk/low-level", () => ({
  useXRPipelineSnapshot: () => [],
  useXRContext: () => SESSION,
  useXRReady: () => ready,
  useXRError: () =>
    reason ? { error: "PermissionError", message: "m", reason } : undefined,
}));

vi.mock("@vincentt-xr/sdk", async () => {
  const { createElement } = await import("react");
  return {
    XRProvider: ({ children }: { children?: unknown }) => children,
    XRScene: () => createElement("div", { "data-testid": "scene" }),
    AspectRatioContainer: ({ children }: { children?: unknown }) =>
      createElement("div", null, children as never),
    VideoBackground: () => null,
    XRMediaSource: { WEBCAM: "webcam", STREAM: "stream" },
  };
});

vi.mock("./Scene", () => ({ Scene: () => null }));
vi.mock("./PreviewAnchors", () => ({ PreviewAnchors: () => null }));
vi.mock("@react-three/drei", () => ({ PerspectiveCamera: () => null }));
vi.mock("./MediaSourceControl", () => ({ MediaSourceControl: () => null }));
vi.mock("./mediaStream", () => ({
  streamFromImageUrl: vi.fn(
    async () => ({ id: "img" }) as unknown as MediaStream,
  ),
  streamFromVideoUrl: vi.fn(async () => ({
    stream: { id: "vid" } as unknown as MediaStream,
    stop: () => undefined,
  })),
}));

/** The `SessionSignal` handed over on the most recent feed. */
const lastSignal = () =>
  reportSession.mock.calls[reportSession.mock.calls.length - 1]?.[0];

beforeEach(() => {
  ready = false;
  reason = undefined;
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("the shell's viewer beacon", () => {
  it("mounts the beacon exactly once, and re-rendering does not remount it", () => {
    const { rerender } = render(<Shell />);
    expect(mountViewerBeacon).toHaveBeenCalledTimes(1);

    ready = true;
    rerender(<Shell />);
    // A second mount would arm a second report for one visit. The empty dep array
    // is what prevents it, and this is the assertion that holds it there.
    expect(mountViewerBeacon).toHaveBeenCalledTimes(1);
  });

  it("takes no argument — the beacon reads no configuration from the app", () => {
    render(<Shell />);
    // The endpoint is a literal inside the package. If an options object ever
    // appears here, a creator's local settings have become able to redirect their
    // viewers' reports.
    expect(mountViewerBeacon).toHaveBeenCalledWith();
  });

  it("returns the beacon's own cleanup, so unmounting tears the listeners down", () => {
    const { unmount: unmountShell } = render(<Shell />);
    expect(unmount).not.toHaveBeenCalled();
    unmountShell();
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it("feeds the SDK's ready flag through", () => {
    const { rerender } = render(<Shell />);
    expect(lastSignal()).toEqual({ ready: false, reason: undefined });

    ready = true;
    rerender(<Shell />);
    expect(lastSignal()).toEqual({ ready: true, reason: undefined });
  });

  it("feeds the SDK's `reason` enum through, and never its prose", () => {
    reason = "permission-denied";
    render(<Shell />);

    const signal = lastSignal();
    expect(signal).toEqual({ ready: false, reason: "permission-denied" });
    // `message` is vendor prose and `error` is a constant. Neither may reach the
    // wire; only the stable machine-readable identity does.
    expect(signal).not.toHaveProperty("message");
    expect(signal).not.toHaveProperty("error");
  });

  it("does not re-feed the beacon when unrelated shell state changes", () => {
    const { rerender } = render(<Shell />);
    const before = reportSession.mock.calls.length;

    rerender(<Shell />);
    // `ready` and `reason` are the only deps. A re-feed on every render would be
    // harmless but hides a dependency the next editor would have to rediscover.
    expect(reportSession.mock.calls.length).toBe(before);
  });
});
