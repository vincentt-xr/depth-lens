import { defineConfig } from "vitest/config";

// The template builds with esbuild, not Vite, so this config exists only for the
// test run. `import.meta.env` is defined here the way esbuild.config.mjs defines
// it for a real build — as a populated object — so a test exercises the same
// property access the shipped code does. Individual tests override the env by
// passing it in rather than by mutating a global.
export default defineConfig({
  define: {
    "import.meta.env": JSON.stringify({
      MODE: "test",
      PROD: false,
      DEV: true,
      BASE_URL: "/",
    }),
  },
  test: {
    environment: "jsdom",
    // scripts/ is included so the zone-manifest validator has tests. A test for it
    // may not live in src/: every src/* file must be classified in
    // .vincentt-template.json and would therefore ship into every creator's repo.
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
  },
});
