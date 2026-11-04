// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// On Vercel builds (VERCEL=1 is set automatically by Vercel) pin Nitro's
// `vercel` preset; everywhere else (Lovable hosting) keep the default
// Cloudflare-compatible target. Inside a Lovable build LOVABLE_NITRO_PRESET wins.
const isVercel = !!process.env["VERCEL"];

export default defineConfig({
  ...(isVercel ? { nitro: { preset: "vercel" } } : {}),
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
