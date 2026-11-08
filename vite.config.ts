import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { cp } from "node:fs/promises";

export default defineConfig({
  // phonemizer embeds an Emscripten/espeak file system that breaks when rebundled.
  // kokoro-js and transformers stay bundled together so setting transformers' cacheDir
  // reaches the same module instance kokoro uses.
  ssr: { external: ["phonemizer"] },
  plugins: [
    tanstackStart(),
    nitro({
      traceDeps: ["phonemizer*"],
      hooks: {
        // kokoro-js loads voice styles from `../voices` relative to its bundled module.
        async compiled(nitro) {
          await cp("node_modules/kokoro-js/voices", `${nitro.options.output.serverDir}/voices`, {
            recursive: true,
          });
        },
      },
      // The first Kokoro call downloads the ~90 MB model, so give the function room.
      vercel: { functions: { maxDuration: 60, memory: 1024 } },
    }),
    viteReact(),
    tailwindcss(),
    tsconfigPaths(),
  ],
});
