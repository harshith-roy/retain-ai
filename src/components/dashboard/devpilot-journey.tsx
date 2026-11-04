import { Link } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { ExternalLink, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, StatusPill, label } from "@/components/dashboard/ui";
import { authStore } from "@/lib/firebase/auth";
import { useJourney } from "@/lib/paypal/journey-store";
import { DEVPILOT, isVerifiedRetained } from "@/lib/paypal/journey";

/** Merchant-side view of the DevPilot AI demo customer journey. */
export function DevpilotJourneyPanel({
  focus = "all",
}: {
  focus?: "all" | "subscription" | "session" | "approval" | "revenue";
}) {
  const snap = useSyncExternalStore(
    authStore.subscribe,
    authStore.getSnapshot,
    authStore.getServerSnapshot,
  );
  const { journey: j, state, error } = useJourney(snap.user?.uid);
  const d = j.decision;
  const retained = isVerifiedRetained(j.customerChoice === "accepted", j.verifiedStatus);
  const outcomeTone =
    j.paypalOutcome === "verified"
      ? "success"
      : j.paypalOutcome === "paypal_failed" || j.paypalOutcome === "rejected"
        ? "warning"
        : "muted";
  return (
    <Panel
      className="mb-4"
      title="DevPilot AI demo journey"
      description="Fictional merchant · Pro Monthly · $29/month · PayPal Sandbox"
      action={
        <Button asChild size="sm" variant="outline">
          <Link to="/portal/devpilot">
            <ExternalLink className="size-4" />
            Open customer portal
          </Link>
        </Button>
      }
    >
      <p className="mb-3 flex items-center gap-1.5 text-xs text-cyan">
        <FlaskConical className="size-3.5" />
        {state === "loading"
          ? "Loading saved journey…"
          : state === "error"
            ? `Saved journey unavailable: ${error}`
            : "Journey saved in your workspace. Subscription status is confirmed with PayPal Sandbox."}
      </p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Item
          k="PayPal subscription"
          v={
            j.subscriptionId ? (
              <span className="font-mono text-xs">{j.subscriptionId}</span>
            ) : (
              "Not connected"
            )
          }
        />
        <Item
          k="Verified status"
          v={
            j.verifiedStatus ? (
              <StatusPill tone={j.verifiedStatus === "ACTIVE" ? "success" : "muted"}>
                {label(j.verifiedStatus.toLowerCase())}
              </StatusPill>
            ) : (
              "—"
            )
          }
          sub={j.verifiedAt ? `checked ${new Date(j.verifiedAt).toLocaleString()}` : undefined}
        />
        {focus !== "subscription" && (
          <Item
            k="Cancellation reason"
            v={j.reason ? label(j.reason) : "—"}
            sub={j.reasonDetail || undefined}
          />
        )}
        {focus !== "subscription" && (
          <Item
            k="AI offer"
            v={d?.offer ? d.offer.title : d ? "No offer" : "—"}
            sub={
              d
                ? d.violations.length
                  ? `Guardrails: ${d.violations.map(label).join(", ")}`
                  : "All policy checks passed"
                : undefined
            }
          />
        )}
        <Item
          k="Approval"
          v={
            j.approval === "pending" ? (
              <StatusPill tone="warning">Awaiting merchant</StatusPill>
            ) : j.approval === "approved" ? (
              <StatusPill tone="success">Approved</StatusPill>
            ) : j.approval === "rejected" ? (
              <StatusPill tone="muted">Rejected</StatusPill>
            ) : d ? (
              "Not required"
            ) : (
              "—"
            )
          }
        />
        <Item k="Customer choice" v={j.customerChoice ? label(j.customerChoice) : "—"} />
        <Item
          k="PayPal operation"
          v={
            j.paypalOutcome ? (
              <StatusPill tone={outcomeTone}>{label(j.paypalOutcome)}</StatusPill>
            ) : (
              "—"
            )
          }
          sub={j.paypalReason ?? undefined}
        />
        <Item
          k="Revenue"
          v={
            retained
              ? `$${DEVPILOT.monthlyPrice}/mo verified retained`
              : j.customerChoice === "accepted"
                ? `$${DEVPILOT.monthlyPrice}/mo estimated (not verified)`
                : "—"
          }
          sub="Retained = offer accepted and PayPal still reports Active or Suspended"
        />
      </dl>
      {focus === "all" && j.audit.length > 0 && (
        <ol className="mt-4 space-y-1 border-t pt-3">
          {j.audit.slice(0, 6).map((a, i) => (
            <li key={i} className="text-xs text-muted-foreground">
              <span className="tabular-nums">{new Date(a.at).toLocaleString()}</span> ·{" "}
              <span className="text-foreground">{label(a.kind)}</span> — {a.detail}
              {a.verified ? " ✓ PayPal" : ""}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
function Item({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="mt-1">{v}</dd>
      {sub && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
