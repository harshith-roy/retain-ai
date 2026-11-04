import { commit, getDoc, type Json, type Write } from "@/lib/firebase/admin.server";
import type { Decision } from "@/lib/retention/guardrails";
import { DEVPILOT } from "@/lib/paypal/journey";
import { journeyFromDoc, sessionStatusFor, type ActivityEntry, type JourneyView } from "./model";

export interface Identity {
  uid: string;
  email: string;
  name: string;
}
export interface Membership {
  merchantId: string;
  role: string;
}

/** Merchant access always comes from the server-read membership record, never from the client. */
export async function resolveMerchant(uid: string): Promise<Membership> {
  const m = await getDoc(`merchantUsers/${uid}`);
  const merchantId = typeof m?.["merchantId"] === "string" ? m["merchantId"] : null;
  if (!m || !merchantId || m["uid"] !== uid)
    throw new Error("No RETAIN.AI workspace is linked to this account.");
  return { merchantId, role: String(m["role"] ?? "") };
}

export const activity = (kind: string, detail: string, verified?: boolean): ActivityEntry => ({
  id: crypto.randomUUID(),
  at: new Date().toISOString(),
  kind,
  detail: detail.slice(0, 600),
  ...(verified !== undefined ? { verified } : {}),
});

const journeyPath = (m: string, uid: string) => `merchants/${m}/journeys/devpilot_${uid}`;
export async function readJourney(m: string, uid: string): Promise<JourneyView> {
  return journeyFromDoc(await getDoc(journeyPath(m, uid)));
}
export function journeyWrite(
  m: string,
  uid: string,
  data: Record<string, unknown>,
  ...entries: ActivityEntry[]
): Write {
  return {
    op: "merge",
    path: journeyPath(m, uid),
    data: { ...data, customerUid: uid, updatedAt: new Date().toISOString() },
    append: entries.length ? { activity: entries } : undefined,
  };
}

// --- Idempotency: one claim document per action key, created atomically. ---
export async function claim(
  m: string,
  key: string,
): Promise<{ fresh: true } | { fresh: false; result: Json | null }> {
  const path = `merchants/${m}/idempotency/${key}`;
  if (
    await commit([
      { op: "create", path, data: { status: "in_progress", createdAt: new Date().toISOString() } },
    ])
  )
    return { fresh: true };
  const d = await getDoc(path);
  return { fresh: false, result: (d?.["result"] as Json) ?? null };
}
export const finishClaim = (m: string, key: string, result: unknown): Write => ({
  op: "set",
  path: `merchants/${m}/idempotency/${key}`,
  data: { status: "done", result, finishedAt: new Date().toISOString() },
});

// --- Settings (policy + approved brand profile) ---
export async function readSettings(m: string) {
  return getDoc(`merchants/${m}/settings/retention`);
}

// --- Offer persistence ---
export async function persistOffer(input: {
  m: string;
  who: Identity;
  requestId: string;
  reason: string;
  reasonDetail: string;
  decision: Decision;
  policy: unknown;
  decisionToken: string;
  monthlyPrice: number;
  offersMade: number;
}) {
  const { m, who, requestId, decision } = input;
  const now = new Date().toISOString();
  const passed = decision.violations.length === 0;
  const entries = [
    activity("cancellation_reason", `${input.reason}: “${input.reasonDetail.slice(0, 140)}”`),
    activity(
      "ai_offer",
      `${decision.status}${decision.offer ? ` · ${decision.offer.title}` : ""}${passed ? " · all policy checks passed" : ` · guardrails: ${decision.violations.join(", ")}`}`,
    ),
    ...(decision.status === "needs_approval"
      ? [activity("approval_requested", "Offer is waiting for merchant approval.")]
      : []),
  ];
  const writes: Write[] = [
    {
      op: "create",
      path: `merchants/${m}/retentionSessions/${requestId}`,
      data: {
        customerUid: who.uid,
        customerName: who.name,
        customerEmail: who.email,
        source: "devpilot_portal",
        reason: input.reason,
        reasonDetail: input.reasonDetail,
        offer: decision.offer?.title ?? "No offer",
        status: sessionStatusFor({
          decisionStatus: decision.status,
          approval: decision.status === "needs_approval" ? "pending" : null,
          choice: null,
          verifiedStatus: null,
          outcome: null,
        }),
        estimatedValue: decision.offer
          ? input.monthlyPrice * Math.max(1, decision.offer.durationMonths)
          : 0,
        startedAt: now,
        decision: decision as unknown as Record<string, unknown>,
        decisionToken: input.decisionToken,
        policyCheck: { passed, violations: decision.violations },
        policySnapshot: input.policy,
        approval: decision.status === "needs_approval" ? "pending" : "not_required",
        customerChoice: null,
        paypalOutcome: null,
        verifiedStatus: null,
        activity: entries,
      },
    },
    journeyWrite(
      m,
      who.uid,
      {
        reason: input.reason,
        reasonDetail: input.reasonDetail,
        currentSessionId: requestId,
        offersMade: input.offersMade,
        customerChoice: null,
        paypalOutcome: null,
        paypalReason: null,
      },
      ...entries,
    ),
  ];
  if (decision.status === "needs_approval")
    writes.push({
      op: "create",
      path: `merchants/${m}/approvals/${requestId}`,
      data: {
        sessionId: requestId,
        customerUid: who.uid,
        customerName: who.name,
        type: decision.offer?.type ?? "offer",
        title: decision.offer?.title ?? "Offer",
        amount: decision.offer
          ? Math.round(input.monthlyPrice * decision.offer.discountPct) / 100
          : 0,
        reason: decision.rationale.slice(0, 400),
        status: "pending",
        createdAt: now,
      },
    });
  return commit(writes); // false => this requestId was already stored (duplicate submit)
}

export async function upsertVerifiedSubscription(
  m: string,
  who: Identity,
  sub: { id: string; status: string; amount: number | null; startTime: string | null },
  ...entries: ActivityEntry[]
) {
  const status =
    (
      {
        ACTIVE: "active",
        SUSPENDED: "paused",
        CANCELLED: "cancelled",
        EXPIRED: "cancelled",
      } as Record<string, string>
    )[sub.status] ?? "trialing";
  const now = new Date().toISOString();
  await commit([
    {
      op: "merge",
      path: `merchants/${m}/subscriptions/${sub.id}`,
      data: {
        customerUid: who.uid,
        customerName: who.name,
        plan: DEVPILOT.planDisplayName,
        amount: sub.amount ?? DEVPILOT.monthlyPrice,
        interval: "month",
        status,
        paypalStatus: sub.status,
        startedAt: sub.startTime ?? now,
        verifiedAt: now,
        source: "paypal_sandbox",
      },
    },
    {
      op: "merge",
      path: `merchants/${m}/customers/${who.uid}`,
      data: {
        name: who.name,
        email: who.email,
        plan: DEVPILOT.planDisplayName,
        status: status === "cancelled" ? "churned" : "active",
        mrr: status === "active" ? (sub.amount ?? DEVPILOT.monthlyPrice) : 0,
        createdAt: sub.startTime ?? now,
      },
    },
    journeyWrite(
      m,
      who.uid,
      { subscriptionId: sub.id, verifiedStatus: sub.status, verifiedAt: now },
      ...entries,
    ),
  ]);
}

export async function readSession(m: string, id: string) {
  return getDoc(`merchants/${m}/retentionSessions/${id}`);
}
