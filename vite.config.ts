import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // phonemizer embeds an Emscripten/espeak file system that breaks when rebundled,
  // and kokoro-js reads voice .bin files next to its package at runtime.
  ssr: { external: ["kokoro-js", "phonemizer", "@huggingface/transformers"] },
  plugins: [
    tanstackStart(),
    nitro({
      // Traced as-is into node_modules of the server output, including voice data.
      traceDeps: ["kokoro-js*", "phonemizer*"],
      // The first Kokoro call downloads the ~90 MB model, so give the function room.
      vercel: { functions: { maxDuration: 60, memory: 1024 } },
    }),
    viteReact(),
    tailwindcss(),
    tsconfigPaths(),
  ],
});
