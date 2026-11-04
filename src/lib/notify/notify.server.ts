import { inngest } from "./inngest-client.server";

/**
 * Server-only outbound integrations: Slack, Resend, PostHog,
 * Inngest and ElevenLabs.
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

// --- ElevenLabs ---

export async function speak(text: string): Promise<string> {
  const key = process.env["ELEVENLABS_API_KEY"];
  if (!key) throw new Error("Voice is not configured.");

  const res = await fetch(
    "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=mp3_44100_64",
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text.slice(0, 900),
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
        },
      }),
    },
  );

  if (!res.ok) {
    console.error(`ElevenLabs ${res.status}: ${await res.text()}`);
    throw new Error(`Voice generation failed (${res.status}).`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  let s = "";

  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(s);
}
