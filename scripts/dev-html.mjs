/**
 * The development page: `index.html` pointed at the unhashed dev bundle, plus
 * live reload. Used by `scripts/dev.mjs` only. The production build
 * (`vincentt build`) never reads this module, which is what keeps the reload
 * snippet out of `dist/`.
 *
 * Live reload listens to esbuild's own `GET /esbuild` event stream, which emits
 * `change` after every rebuild that changed an output. The stream is same-origin,
 * so it rides whatever carries the page: the loopback forwarder in dev.mjs, the
 * `vincentt preview` proxy and tunnel to a phone, or the desktop editor's app
 * view. The editor's bridge holds the event for a write it made itself, so the
 * snippet resolves `EventSource` and `location.reload` at run time rather than
 * capturing them.
 */

export const LIVE_RELOAD_SNIPPET = `<script>
      new EventSource("/esbuild").addEventListener("change", function () {
        location.reload();
      });
    </script>`;

export function devIndexHtml(html) {
  return html
    .replace(
      /<link[^>]+href="\/src\/index\.css"[^>]*>/,
      `<link rel="stylesheet" href="/assets/main.css" />`,
    )
    .replace(
      /<script[^>]+src="\/src\/main\.tsx"[^>]*><\/script>/,
      `<script type="module" src="/assets/main.js"></script>`,
    )
    .replace("</head>", `  ${LIVE_RELOAD_SNIPPET}\n  </head>`);
}
