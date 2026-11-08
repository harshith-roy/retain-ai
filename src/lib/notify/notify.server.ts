import { inngest } from "./inngest-client.server";

/**
 * Server-only outbound integrations: Slack, Resend, PostHog,
 * Inngest and local Kokoro text-to-speech.
 *
 * Notifications are best-effort and never alter PayPal outcomes.
 */

export type SendResult = { ok: true } | { ok: false; error: string };

async function safe(name: string, fn: () => Promise<void>): Promise<SendResult> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[notify:${name}] ${error}`);
    return { ok: false, error };
  }
}

// --- Slack ---

export const slackChannel = () => process.env["SLACK_APPROVAL_CHANNEL"] || "all-roy";

export function slackPost(text: string, blocks?: unknown[]) {
  return safe("slack", async () => {
    const token = process.env["SLACK_BOT_TOKEN"];
    if (!token) throw new Error("SLACK_BOT_TOKEN is not configured.");

    const channel = slackChannel().replace(/^#/, "");

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text,
        ...(blocks ? { blocks } : {}),
      }),
    });

    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };

    if (!res.ok || !body.ok) {
      throw new Error(`Slack ${res.status}: ${body.error ?? "unknown"}`);
    }
  });
}

export function approvalBlocks(a: {
  customerName: string;
  offerTitle: string;
  reason: string;
  amount: number;
  reviewUrl: string;
  escalated?: boolean;
}) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${a.escalated ? ":rotating_light: *Escalation - approval still pending*" : ":raised_hand: *Retention offer needs approval*"}\n*Customer:* ${a.customerName}\n*Offer:* ${a.offerTitle} (approx. $${a.amount.toFixed(2)}/mo)\n*Why:* ${a.reason.slice(0, 280)}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Review in RETAIN.AI" },
          url: a.reviewUrl,
          style: "primary",
        },
      ],
    },
  ];
}

// --- Resend ---

export function sendEmail(to: string, subject: string, html: string, idempotencyKey: string) {
  return safe("resend", async () => {
    if (!to) throw new Error("No recipient email.");

    const key = process.env["RESEND_API_KEY"];
    if (!key) throw new Error("RESEND_API_KEY is not configured.");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: process.env["RESEND_FROM"] || "DevPilot AI via RETAIN.AI <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  });
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );

export function outcomeEmail(name: string, headline: string, detail: string) {
  return `<div style="font-family:Arial,sans-serif;background:#ffffff;padding:24px;color:#111"><h2 style="margin:0 0 12px">${esc(headline)}</h2><p>Hi ${esc(name)},</p><p>${esc(detail)}</p><p style="color:#666;font-size:12px;margin-top:24px">DevPilot AI is a fictional demo merchant powered by RETAIN.AI (PayPal Sandbox - no real money moves).</p></div>`;
}

// --- PostHog ---

export function capture(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {},
) {
  return safe("posthog", async () => {
    const key = process.env["POSTHOG_API_KEY"];
    if (!key) throw new Error("POSTHOG_API_KEY is not configured.");

    const host =
      process.env["POSTHOG_REGION"] === "us"
        ? "https://us.i.posthog.com"
        : "https://eu.i.posthog.com";

    const res = await fetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: distinctId,
        properties: { ...properties, app: "retain.ai" },
      }),
    });

    if (!res.ok) throw new Error(`PostHog ${res.status}`);
  });
}

// --- Inngest ---

export function sendEvent(name: string, data: Record<string, unknown>, id?: string) {
  return safe("inngest", async () => {
    if (!process.env["INNGEST_EVENT_KEY"] && process.env["INNGEST_DEV"] !== "1") {
      throw new Error("INNGEST_EVENT_KEY is not configured.");
    }

    await inngest.send({
      name,
      data,
      ...(id ? { id } : {}),
    });
  });
}

// --- Kokoro TTS (local, open source) ---

const TTS_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const TTS_VOICE = "af_heart";

let engine: Promise<import("kokoro-js").KokoroTTS> | null = null;

async function ttsEngine() {
  if (!engine) {
    engine = (async () => {
      const [{ KokoroTTS }, { env }] = await Promise.all([
        import("kokoro-js"),
        import("@huggingface/transformers"),
      ]);
      // Serverless filesystems are read-only; the model must cache under /tmp.
      if (process.env["VERCEL"]) env.cacheDir = "/tmp/kokoro-cache";
      env.allowLocalModels = false;
      return KokoroTTS.from_pretrained(TTS_MODEL, { dtype: "q8" });
    })().catch((e) => {
      engine = null;
      throw e;
    });
  }
  return engine;
}

/** Sentence-aware chunks so no chunk gets truncated by the model's token limit. */
function speechChunks(text: string, max = 400): string[] {
  const out: string[] = [];
  let current = "";
  for (const sentence of text.match(/[^.!?]+[.!?]*/g) ?? [text]) {
    const rest = sentence.trim();
    if (!rest) continue;
    if (current && current.length + rest.length + 1 > max) {
      out.push(current);
      current = "";
    }
    current = current ? `${current} ${rest}` : rest;
    while (current.length > max) {
      out.push(current.slice(0, max));
      current = current.slice(max);
    }
  }
  if (current) out.push(current);
  return out;
}

function wavBase64(samples: Float32Array, sampleRate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function speak(text: string): Promise<{ audio: string; mime: string }> {
  const tts = await ttsEngine();
  const parts: Float32Array[] = [];
  let sampleRate = 24_000;

  for (const chunk of speechChunks(text.slice(0, 900))) {
    const out = await tts.generate(chunk, { voice: TTS_VOICE });
    sampleRate = out.sampling_rate;
    parts.push(out.audio);
  }

  const total = parts.reduce((n, a) => n + a.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    samples.set(part, offset);
    offset += part.length;
  }

  return { audio: wavBase64(samples, sampleRate), mime: "audio/wav" };
}
