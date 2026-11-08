import type { Decision } from "@/lib/retention/guardrails";

/** Pure, client-safe shapes for persisted journey records. */
export interface ActivityEntry {
  id: string;
  at: string;
  kind: string;
  detail: string;
  verified?: boolean;
}
export type ApprovalState = "not_required" | "pending" | "approved" | "rejected";
export interface JourneyView {
  subscriptionId: string | null;
  pendingSubscriptionId: string | null;
  reason: string | null;
  reasonDetail: string;
  currentSessionId: string | null;
  decision: Decision | null;
  approval: ApprovalState | null;
  offersMade: number;
  customerChoice: "accepted" | "declined" | "cancel" | null;
  paypalOutcome: string | null;
  paypalReason: string | null;
  verifiedStatus: string | null;
  verifiedAt: string | null;
  audit: ActivityEntry[];
}
export const EMPTY_JOURNEY: JourneyView = {
  subscriptionId: null,
  pendingSubscriptionId: null,
  reason: null,
  reasonDetail: "",
  currentSessionId: null,
  decision: null,
  approval: null,
  offersMade: 0,
  customerChoice: null,
  paypalOutcome: null,
  paypalReason: null,
  verifiedStatus: null,
  verifiedAt: null,
  audit: [],
};

const s = (v: unknown) => (typeof v === "string" ? v : null);
export function journeyFromDoc(d: Record<string, unknown> | null): JourneyView {
  if (!d) return EMPTY_JOURNEY;
  const audit = (Array.isArray(d["activity"]) ? (d["activity"] as ActivityEntry[]) : [])
    .filter((a) => a && typeof a.at === "string")
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 100);
  const choice = s(d["customerChoice"]);
  return {
    ...EMPTY_JOURNEY,
    subscriptionId: s(d["subscriptionId"]),
    pendingSubscriptionId: s(d["pendingSubscriptionId"]),
    reason: s(d["reason"]),
    reasonDetail: s(d["reasonDetail"]) ?? "",
    currentSessionId: s(d["currentSessionId"]),
    offersMade: typeof d["offersMade"] === "number" ? d["offersMade"] : 0,
    customerChoice:
      choice === "accepted" || choice === "declined" || choice === "cancel" ? choice : null,
    paypalOutcome: s(d["paypalOutcome"]),
    paypalReason: s(d["paypalReason"]),
    verifiedStatus: s(d["verifiedStatus"]),
    verifiedAt: s(d["verifiedAt"]),
    audit,
  };
}

/**
 * Dashboard session status. "retained" and "cancelled" require a PayPal-verified
 * status; an accepted offer alone is never counted as retained.
 */
export function sessionStatusFor(x: {
  decisionStatus: Decision["status"];
  approval: ApprovalState | null;
  choice: JourneyView["customerChoice"];
  verifiedStatus: string | null;
  outcome: string | null;
}): "active" | "retained" | "cancelled" | "escalated" {
  if (x.choice === "cancel" && x.outcome === "verified" && x.verifiedStatus === "CANCELLED")
    return "cancelled";
  if (
    x.choice === "accepted" &&
    x.outcome === "verified" &&
    (x.verifiedStatus === "ACTIVE" || x.verifiedStatus === "SUSPENDED")
  )
    return "retained";
  if (x.approval === "pending") return "escalated";
  return "active";
}

/** Approval decisions turn a pending proposal into a customer-visible offer, or withdraw it. */
export function applyApproval(d: Decision, outcome: "approved" | "rejected"): Decision {
  if (d.status === "escalated")
    return {
      status: "no_offer",
      offer: null,
      message:
        outcome === "approved"
          ? "A member of the DevPilot team has picked this up and will follow up with you here. You can still continue with cancellation at any time."
          : "Thanks for your patience. We weren't able to arrange a different outcome this time. You can still continue with cancellation at any time.",
      rationale: d.rationale,
      violations: d.violations,
    };
  if (d.status !== "needs_approval") throw new Error("This offer is not waiting for approval.");
  if (outcome === "approved") return { ...d, status: "offer" };
  return {
    ...d,
    status: "no_offer",
    offer: null,
    message: "Thanks for your patience. We weren't able to offer an alternative this time.",
  };
}
