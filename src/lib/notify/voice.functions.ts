import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { guardUsage } from "@/lib/security/guard.server";

/** Speak a retention message aloud (ElevenLabs). Linked workspace members only, rate limited. */
export const speakRetentionMessage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ idToken: z.string().min(20).max(4096), text: z.string().min(1).max(900) }).parse(d),
  )
  .handler(async ({ data }) => {
    try {
      await guardUsage(data.idToken, "voice");
      const { speak } = await import("./notify.server");
      return { ok: true as const, audio: await speak(data.text) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Voice failed." };
    }
  });
