// The in-app switcher's mount rule, pinned in BOTH directions.
//
// FRAMED it renders nothing: the console draws the source control in its own
// chrome beside the frame, so an in-app mount would be the creator's second
// switcher in one workspace.
//
// UNFRAMED it renders exactly as it always has. That arm is the case, not a
// courtesy — "gated, not deleted" is a claim about two states, and a build that
// deleted the control outright satisfies the framed arm perfectly.
//
// The webcam entry is no longer filtered in either direction. The frame now
// carries a per-session camera delegation, so the tap that used to dead-end on
// unrecoverable "Allow camera access" advice raises a real prompt instead.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultMediaSources, sdkVideoMediaSources } from "@vincentt-xr/sdk/debug-ui/media-source";

import { MediaSourceControl } from "./MediaSourceControl";

const FRAMED_PRESET = sdkVideoMediaSources[0];

const frameIt = () => {
  vi.spyOn(window, "top", "get").mockReturnValue({ name: "embedder" } as unknown as Window);
};

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn().mockRejectedValue(new Error("getUserMedia must not be called"));
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  // The switcher portals into document.body, so unmounting is explicit here —
  // otherwise each test's control accumulates and every query finds several.
  cleanup();
  vi.restoreAllMocks();
});

const openPanel = async () => {
  const fab = await screen.findByTitle("Open Media Menu");
  fab.click();
};

const settle = async () => {
  // The mount is gated before a dynamic import, so "nothing appeared" has to be
  // asserted after the microtask that import would have resolved on. Without
  // this the framed assertions pass against a control that simply had not
  // finished loading yet.
  await waitFor(() => expect(document.body).toBeTruthy());
  await Promise.resolve();
};

describe("MediaSourceControl · framed", () => {
  it("mounts NO node — the console owns the control outside the frame", async () => {
    frameIt();
    const { container } = render(<MediaSourceControl value={FRAMED_PRESET} onChange={vi.fn()} />);

    await settle();
    expect(container.firstChild).toBeNull();
    expect(document.querySelector('[title="Open Media Menu"]')).toBeNull();
  });

  it("renders nothing even with a configured source the app bound itself", async () => {
    frameIt();
    const configured = {
      id: "configured",
      kind: "video",
      label: "Configured input",
      url: "https://example.test/client-footage.mp4",
    };
    render(<MediaSourceControl value={configured} onChange={vi.fn()} />);

    await settle();
    expect(document.querySelector('[title="Open Media Menu"]')).toBeNull();
  });

  it("never reaches getUserMedia, since nothing is mounted to tap", async () => {
    frameIt();
    render(<MediaSourceControl value={FRAMED_PRESET} onChange={vi.fn()} />);

    await settle();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe("MediaSourceControl · unframed", () => {
  it("mounts the switcher — the positive control that makes the framed arm mean something", async () => {
    render(<MediaSourceControl value={defaultMediaSources[0]} onChange={vi.fn()} />);

    await openPanel();
    expect(await screen.findByRole("combobox")).toBeTruthy();
  });

  it("keeps the webcam entry, unchanged from today", async () => {
    const webcam = defaultMediaSources.find((p) => p.kind === "webcam");
    expect(webcam).toBeDefined();
    render(<MediaSourceControl value={webcam!} onChange={vi.fn()} />);

    await openPanel();
    await screen.findByRole("combobox");
    const optionValues = screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(optionValues).toContain("webcam");
  });

  it("shows a configured source as selected, alongside the SDK's own presets", async () => {
    // The SDK's switcher lists options per kind TAB, so the video tab shows the
    // video presets — the webcam entry lives under its own tab and is asserted
    // by the webcam test above, not here.
    const configured = {
      id: "configured",
      kind: "video",
      label: "Configured input",
      url: "https://example.test/client-footage.mp4",
    };
    render(<MediaSourceControl value={configured} onChange={vi.fn()} />);

    await openPanel();
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    expect(select.value).toBe("configured");
    expect([...select.options].map((o) => o.value)).toContain("sdk-video-idle-woman");
  });
});

describe("MediaSourceControl · production", () => {
  it("mounts nothing when disabled, so a published bundle never loads the switcher", async () => {
    const { container } = render(
      <MediaSourceControl value={FRAMED_PRESET} onChange={vi.fn()} enabled={false} />,
    );

    await settle();
    expect(container.firstChild).toBeNull();
    expect(document.querySelector('[title="Open Media Menu"]')).toBeNull();
  });
});
