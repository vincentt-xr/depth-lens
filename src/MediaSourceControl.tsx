import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";

import { isFramed } from "./framed";

// The SDK's runtime media switcher — the control a creator swaps inputs with
// while the app is running.
//
// WHY THE MOUNT IS THE APP'S. The switcher is CONTROLLED: it takes
// `value`/`onChange` and holds no source state of its own, so whoever mounts it
// must own the selected source AND be able to apply it to the XR session. The
// harness mounts its overlays as bare DOM outside React and deliberately holds
// no reference to the session, so it cannot be the owner. The app can, and the
// app already owns the startup source decision.
//
// FRAMED: this renders NOTHING. The console draws the source control in its own
// chrome beside the frame, so mounting here too would give the creator two
// switchers in one workspace. GATED, NOT DELETED — an unframed local preview
// (`vincentt preview` opened directly) has no console chrome around it to take
// over, so it keeps the in-app switcher.
//
// DYNAMIC IMPORT BEHIND A GUARD, never a static import. The preset module
// carries 12 CDN URLs and the switcher pulls in an icon dependency. A static
// import would inline both into the entry bundle every visitor downloads; the
// dynamic import keeps them in their own code-split chunk, fetched only when the
// guard is true. Do not hoist either import to the top level.
//
// WHAT THE GUARD DOES AND DOES NOT DROP. `enabled` defaults to
// `import.meta.env.DEV`, which esbuild.config.mjs defines per key so a
// production build folds the DEFAULT to a literal `false`. That does not delete
// the chunk: `enabled` is a prop a caller may still pass, and the framed startup
// path imports the same SDK module for its preset list, so the chunk stays in the
// emitted output. What production gets is a mount that never fires, and an entry
// bundle that never carries the switcher; `qa.f13-g13-treeshake` asserts the
// entry-bundle half and the dynamic-import shape of this file.

export type MediaPreset = { id: string; kind: string; label: string; url?: string };

type SwitcherProps = {
  value: MediaPreset;
  onChange: (next: MediaPreset) => void;
  sources: MediaPreset[];
};

type SwitcherModule = {
  Switcher: ComponentType<SwitcherProps>;
  presets: MediaPreset[];
};

export const MediaSourceControl = ({
  value,
  onChange,
  enabled = import.meta.env.DEV,
}: {
  value: MediaPreset | null;
  onChange: (next: MediaPreset) => void;
  /** Defaults to DEV — on in the dev server and preview build, off in a published bundle. */
  enabled?: boolean;
}) => {
  const [loaded, setLoaded] = useState<SwitcherModule | null>(null);
  const framed = isFramed();
  // The framing check gates the IMPORT, not just the render, so a framed app
  // never fetches the switcher chunk it would only throw away.
  const mounts = enabled && !framed;

  useEffect(() => {
    if (!mounts) return undefined;
    let cancelled = false;
    import("@vincentt-xr/sdk/debug-ui/media-source").then((mod) => {
      if (cancelled) return;
      setLoaded({
        Switcher: mod.MediaSourceSwitcher as unknown as ComponentType<SwitcherProps>,
        presets: mod.defaultMediaSources as unknown as MediaPreset[],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [mounts]);

  const sources = useMemo(() => {
    if (!loaded) return [];
    // A source the app bound from its own config is not in the SDK's preset
    // list, so it is prepended — otherwise the control would render with
    // nothing selected while that source is plainly playing.
    if (value && !loaded.presets.some((s) => s.id === value.id)) {
      return [value, ...loaded.presets];
    }
    return loaded.presets;
  }, [loaded, value]);

  if (!mounts || !loaded || !value || sources.length === 0) return null;

  const { Switcher } = loaded;
  return <Switcher value={value} onChange={onChange} sources={sources} />;
};
