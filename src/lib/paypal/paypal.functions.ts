import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { verifyFirebaseIdentity, verifyFirebaseUser } from "@/lib/retention/providers.server";
import { DEVPILOT, authorizeOperation, verifyDecision, type Authorization } from "./journey";
import { PaypalError, createSubscription, findDevpilotPlan, getPlanPrice, getSubscription, isSubscriptionId, runOperation } from "./paypal.server";
import { lookupOwnedSubscription } from "./subscription-lookup";
export type { SubscriptionDTO } from "./subscription-lookup";

const token = z.string().min(20).max(4096);
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof PaypalError ? e.message : e instanceof Error ? e.message : "PayPal request failed." });

export const getPaypalSetup = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ idToken: token }).parse(d))
  .handler(async ({ data }) => {
    try {
      await verifyFirebaseUser(data.idToken);
      const planId = await findDevpilotPlan();
      const price = await getPlanPrice(planId);
      return { ok: true as const, planId, price };
    } catch (e) { return fail(e); }
  });

export const startSandboxSubscription = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ idToken: token, requestId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    try {
      const uid = await verifyFirebaseUser(data.idToken);
      const origin = new URL(getRequest().url).origin;
      const planId = await findDevpilotPlan();
      const r = await createSubscription(planId, uid, `${origin}/portal/devpilot?paypal=approved`, `${origin}/portal/devpilot?paypal=cancelled`, data.requestId);
      const rec = await import("@/lib/records/records.server");
      const { merchantId } = await rec.resolveMerchant(uid);
      const { commit } = await import("@/lib/firebase/admin.server");
      await commit([rec.journeyWrite(merchantId, uid, { pendingSubscriptionId: r.id }, rec.activity("paypal_subscription_created", `Created Sandbox subscription ${r.id}; awaiting customer approval on PayPal.`))]);
      return { ok: true as const, subscriptionId: r.id, approveUrl: r.approveUrl };
    } catch (e) { return fail(e); }
  });

/** Returns details only for subscriptions created for the signed-in user; anything else is "not found". */
export const fetchSubscription = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ idToken: z.string().max(4096), subscriptionId: z.string().max(40) }).parse(d))
  .handler(async ({ data }) => {
    try {
      return await lookupOwnedSubscription(
        { verifyUser: verifyFirebaseUser, isSubscriptionId, getSubscription, getPlanPrice },
        data.idToken, data.subscriptionId,
      );
    } catch (e) { return fail(e); }
  });

const DecisionShape = z.object({ status: z.enum(["offer", "needs_approval", "no_offer"]), offer: z.any().nullable(), message: z.string(), rationale: z.string(), violations: z.array(z.string()) });

/**
 * Customer decision. The offer, approval state and signature come from the
 * persisted session, never from the browser. Each actionId is claimed once in
 * Firestore, so retries and double clicks cannot repeat a PayPal operation.
 */
export const recordCustomerDecision = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    idToken: token, actionId: z.string().uuid(), subscriptionId: z.string().max(40),
    action: z.enum(["accept_offer", "decline_offer", "continue_cancellation"]), consent: z.boolean(),
    offerRequestId: z.string().uuid().nullable(),
  }).parse(d))
  .handler(async ({ data }) => {
    try {
      const who = await verifyFirebaseIdentity(data.idToken);
      const rec = await import("@/lib/records/records.server");
      const { commit } = await import("@/lib/firebase/admin.server");
      const { merchantId } = await rec.resolveMerchant(who.uid);
      const key = `action_${data.actionId}`;
      const c = await rec.claim(merchantId, key);
      if (!c.fresh) {
        const prev = c.result as Awaited<ReturnType<typeof execute>> | null;
        return prev ? { ...prev, duplicate: true } : { ok: false as const, error: "This action is already being processed.", duplicate: true };
      }
      const sess = data.offerRequestId ? await rec.readSession(merchantId, data.offerRequestId) : null;
      if (sess && sess["customerUid"] !== who.uid) throw new Error("That retention session does not belong to you.");
      const decision = (sess?.["decision"] as unknown as z.infer<typeof DecisionShape>) ?? null;
      const result = await execute(who.uid, { ...data, decision, decisionToken: sess ? String(sess["decisionToken"] ?? "") : null }).catch((e: unknown) => ({ ok: true as const, executed: false, outcome: "paypal_failed" as const, reason: e instanceof Error ? e.message : "PayPal request failed.", statusBefore: null, verifiedStatus: null, verified: false }));
      const choice = data.action === "accept_offer" ? "accepted" : data.action === "decline_offer" ? "declined" : "cancel";
      const entries = [rec.activity("customer_decision", data.action), rec.activity(result.executed ? "paypal_operation" : "paypal_no_change", result.reason, result.verified)];
      const writes: Parameters<typeof commit>[0] = [rec.journeyWrite(merchantId, who.uid, { customerChoice: choice, paypalOutcome: result.outcome, paypalReason: result.reason, ...(result.verifiedStatus ? { verifiedStatus: result.verifiedStatus, verifiedAt: new Date().toISOString() } : {}) }, ...entries)];
      if (sess && data.offerRequestId) {
        const { sessionStatusFor } = await import("@/lib/records/model");
        writes.push({ op: "merge", path: `merchants/${merchantId}/retentionSessions/${data.offerRequestId}`, data: { customerChoice: choice, paypalOutcome: result.outcome, paypalReason: result.reason, verifiedStatus: result.verifiedStatus, status: sessionStatusFor({ decisionStatus: decision?.status ?? "no_offer", approval: (sess["approval"] as "pending") ?? null, choice, verifiedStatus: result.verifiedStatus, outcome: result.outcome }) }, append: { activity: entries } });
      }
      writes.push(rec.finishClaim(merchantId, key, result));
      await commit(writes);
      if (result.verifiedStatus && isSubscriptionId(data.subscriptionId)) {
        const price = await getPlanPrice(await findDevpilotPlan()).catch(() => null);
        const s2 = await getSubscription(data.subscriptionId);
        if (s2 && s2.customId === who.uid) await rec.upsertVerifiedSubscription(merchantId, who, { id: s2.id, status: s2.status, amount: price?.amount ?? null, startTime: s2.raw.start_time ?? null });
      }
      const n = await import("@/lib/notify/notify.server");
      await n.capture("retention_customer_decision", merchantId, { customerUid: who.uid, action: data.action, outcome: result.outcome, paypalVerified: result.verified, verifiedStatus: result.verifiedStatus, verifiedRevenueSaved: result.verified && result.verifiedStatus === "SUSPENDED" ? DEVPILOT.monthlyPrice : 0 });
      if (result.verified) {
        const paused = result.verifiedStatus === "SUSPENDED";
        await n.sendEmail(who.email, paused ? "Your DevPilot AI Pro subscription is paused" : "Your DevPilot AI Pro subscription is cancelled", n.outcomeEmail(who.name, paused ? "Subscription paused" : "Subscription cancelled", paused ? "PayPal confirms your subscription is paused. You won't be billed while it's paused." : "PayPal confirms your subscription is cancelled. You won't be billed again."), `outcome-${data.actionId}`);
      }
      return { ...result, duplicate: false };
    } catch (e) { return { ...fail(e), duplicate: false }; }
  });

async function execute(uid: string, data: { actionId: string; subscriptionId: string; action: "accept_offer" | "decline_offer" | "continue_cancellation"; consent: boolean; offerRequestId: string | null; decision: z.infer<typeof DecisionShape> | null; decisionToken: string | null }) {
  const secret = process.env["RETAIN_SIGNING_SECRET"];
  if (!secret) throw new Error("Server signing key is not configured.");
  const sub = isSubscriptionId(data.subscriptionId) ? await getSubscription(data.subscriptionId) : null;
  const decision = data.decision as Parameters<typeof authorizeOperation>[0]["decision"];
  const decisionVerified = !!(decision && data.decisionToken && data.offerRequestId && await verifyDecision(secret, uid, data.offerRequestId, decision, data.decisionToken));
  const auth: Authorization = authorizeOperation({ action: data.action, consent: data.consent, decision, decisionVerified, subscription: sub, uid, expectedPlanId: await findDevpilotPlan() });
  const before = sub?.status ?? null;
  if (!auth.allowed) return { ok: true as const, executed: false, outcome: auth.outcome, reason: auth.reason, statusBefore: before, verifiedStatus: before, verified: false };
  try {
    await runOperation(data.subscriptionId, auth.operation, data.action === "continue_cancellation" ? "Customer chose to cancel via RETAIN.AI" : "Customer accepted pause offer via RETAIN.AI", data.actionId);
  } catch (e) {
    return { ok: true as const, executed: false, outcome: "paypal_failed" as const, reason: e instanceof Error ? e.message : "PayPal operation failed.", statusBefore: before, verifiedStatus: before, verified: false };
  }
  const after = await getSubscription(data.subscriptionId);
  const verified = after?.status === auth.expectedStatus;
  return { ok: true as const, executed: true, outcome: verified ? ("verified" as const) : ("unverified" as const), reason: verified ? `PayPal confirms status ${after?.status}.` : `PayPal accepted the request but reports status ${after?.status ?? "unknown"}.`, statusBefore: before, verifiedStatus: after?.status ?? null, verified };
}
