import { HarnessProvider } from "@vincentt-xr/harness";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

// HarnessProvider is what makes `vincentt logs | network | trace` and
// `vincentt feedback` return anything at all: it patches console.*, wraps
// fetch/XHR, samples performance, and mounts the Share and "Send feedback"
// buttons. The CLI verbs connect to the relay either way, so without this they
// report "no events yet" forever and the reverse channel has nothing to send.
//
// It belongs here rather than in each app because every scaffolded app is a
// copy of this template, and a diagnostics limb that each author has to
// remember to wire is one that is usually not wired.
//
// Safe in production by construction: `enabled` defaults to import.meta.env.DEV
// inside the harness package. esbuild applies `define` to node_modules too, so
// that read folds to a literal `false` in a production build, the same way a
// `if (import.meta.env.DEV)` in this repo's own source does (#112). The
// instrumentation and both overlays are DYNAMIC imports inside the effect, so
// they are emitted as chunks nothing ever loads — emitted rather than dropped
// only because `enabled` is also a prop a caller could pass. Do not pass
// `enabled` explicitly to force it on in a published bundle.
//
// Import only HarnessProvider (and the channel helpers) from the package root.
// The Share and feedback overlays live on the `@vincentt-xr/harness/share` and
// `/annotate` subpaths; a static import of either from app source puts that
// overlay, and the QR code library behind Share, back into every production
// page.
//
// The package is a runtime DEPENDENCY, not a devDependency, even though nothing
// it provides survives into a production run: this file is bundled application
// source, so an install without dev packages must still resolve the import.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <HarnessProvider>
    <App />
  </HarnessProvider>,
);
