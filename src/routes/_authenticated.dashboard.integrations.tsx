import { createFileRoute } from "@tanstack/react-router";
import { Check, Minus } from "lucide-react";
import { PageHeader, StatusPill, type Tone } from "@/components/dashboard/ui";

export const Route = createFileRoute("/_authenticated/dashboard/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations · RETAIN.AI" },
      {
        name: "description",
        content:
          "Honest status of every RETAIN.AI integration: credentials, implementation and verification.",
      },
      { property: "og:title", content: "Integrations · RETAIN.AI" },
      { property: "og:description", content: "Integration status." },
    ],
  }),
  component: Integrations,
});

type Step = boolean | "partial";
// Status reflects what is actually true in this build. Update only when a
// step has been verified, never just because credentials exist.
const ITEMS: {
  name: string;
  purpose: string;
  credentials: Step;
  implemented: Step;
  verified: Step;
  note: string;
}[] = [
  {
    name: "Firebase",
    purpose: "Auth, Firestore, Security Rules",
    credentials: true,
    implemented: true,
    verified: "partial",
    note: "Invitation-only Firestore rules published to project fir-4700f. Server-side Firestore writes and reads verified live. Full Google sign-in through the browser awaiting manual test.",
  },
  {
    name: "PayPal Sandbox",
    purpose: "Subscriptions, offers, verified outcomes",
    credentials: true,
    implemented: true,
    verified: true,
    note: "Verified end to end: subscription approved (ACTIVE), paused (SUSPENDED) and cancelled (CANCELLED), each re-read from PayPal Sandbox.",
  },
  {
    name: "Groq",
    purpose: "Retention agent reasoning",
    credentials: true,
    implemented: true,
    verified: "partial",
    note: "Live offer generation verified from the server; not yet through a signed-in browser session.",
  },
  {
    name: "Firecrawl",
    purpose: "Learn your website and policies",
    credentials: true,
    implemented: true,
    verified: "partial",
    note: "Live website analysis verified from the server; not yet through a signed-in browser session.",
  },
  {
    name: "Kokoro TTS",
    purpose: "Voice retention agent (local, open source)",
    credentials: true,
    implemented: true,
    verified: false,
    note: "Customers can listen to the retention message in the portal. Speech is generated on the server with the open-source Kokoro-82M model — no third-party voice API or key. Full portal journey not yet run.",
  },
  {
    name: "Slack",
    purpose: "Approval alerts and escalations",
    credentials: true,
    implemented: true,
    verified: false,
    note: "Approval requests, decisions and escalations post to Slack with a review link. Approve/reject happens in the Escalation Center.",
  },
  {
    name: "Resend",
    purpose: "Customer outcome emails",
    credentials: true,
    implemented: true,
    verified: false,
    note: "Sent only after PayPal confirms a pause or cancellation. Test sender delivers only to the Resend account owner until a domain is verified.",
  },
  {
    name: "Inngest",
    purpose: "Durable approval workflow",
    credentials: true,
    implemented: true,
    verified: false,
    note: "Retries Slack alerts and escalates approvals still pending after 15 minutes. Runs after the app is published and synced in Inngest.",
  },
  {
    name: "PostHog",
    purpose: "Retention and revenue analytics",
    credentials: true,
    implemented: true,
    verified: false,
    note: "Server events for offers, decisions, approvals and PayPal-verified outcomes only.",
  },
];

function overall(i: (typeof ITEMS)[number]): [Tone, string] {
  if (i.verified === true) return ["success", "Operational"];
  if (i.implemented) return ["cyan", "Implemented · verifying"];
  if (i.credentials) return ["violet", "Credentials only"];
  return ["muted", "Planned"];
}
function Mark({ v }: { v: Step }) {
  if (v === true) return <Check className="mx-auto size-4 text-success" aria-label="Yes" />;
  if (v === "partial")
    return <span className="mx-auto block w-fit text-xs text-warning">Partial</span>;
  return <Minus className="mx-auto size-4 text-muted-foreground/50" aria-label="No" />;
}

function Integrations() {
  return (
    <>
      <PageHeader
        title="Integrations"
        description="An integration is only marked operational after it has been verified end to end."
      />
      <div className="animate-rise overflow-x-auto rounded-xl border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-5 py-3 text-left font-medium">Service</th>
              <th className="px-3 py-3 font-medium">Credentials</th>
              <th className="px-3 py-3 font-medium">Implemented</th>
              <th className="px-3 py-3 font-medium">Verified E2E</th>
              <th className="px-5 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ITEMS.map((i) => {
              const [tone, text] = overall(i);
              return (
                <tr key={i.name} className="transition-colors hover:bg-accent/30">
                  <td className="px-5 py-4">
                    <p className="font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">{i.purpose}</p>
                  </td>
                  <td className="px-3">
                    <Mark v={i.credentials} />
                  </td>
                  <td className="px-3">
                    <Mark v={i.implemented} />
                  </td>
                  <td className="px-3">
                    <Mark v={i.verified} />
                  </td>
                  <td className="px-5 py-4">
                    <StatusPill tone={tone}>{text}</StatusPill>
                    <p className="mt-1 max-w-xs text-xs text-muted-foreground">{i.note}</p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
