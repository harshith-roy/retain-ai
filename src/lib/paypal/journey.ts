import type { Decision, Offer } from "@/lib/retention/guardrails";

/** DevPilot AI is a fictional demonstration merchant; RETAIN.AI is the product. */
export const DEVPILOT = { merchantName: "DevPilot AI", productName: "DevPilot AI Pro", planName: "Pro Monthly", monthlyPrice: 29, currency: "USD", planDisplayName: "DevPilot AI Pro Monthly" } as const;

/** Checkout is offered only after loading, with no subscription or a confirmed terminal one. */
export function canStartCheckout(hasSubscription: boolean, status: string | null, ready: boolean) {
  return ready && (!hasSubscription || status === "CANCELLED" || status === "EXPIRED");
}

export type CustomerAction = "accept_offer" | "decline_offer" | "continue_cancellation";
export type PaypalOperation = "suspend" | "cancel";

export type Authorization =
  | { allowed: true; operation: PaypalOperation; expectedStatus: "SUSPENDED" | "CANCELLED" }
  | { allowed: false; outcome: "no_paypal_change" | "awaiting_approval" | "pending_merchant_action" | "rejected"; reason: string };

export interface SubscriptionSnapshot { id: string; status: string; planId: string; customId: string | null }

/**
 * Decide whether a customer action may trigger a PayPal operation. Pure and
 * server-side; the browser never authorizes a financial change itself.
 */
export function authorizeOperation(input: {
  action: CustomerAction; consent: boolean; decision: Decision | null; decisionVerified: boolean;
  subscription: SubscriptionSnapshot | null; uid: string; expectedPlanId: string;
}): Authorization {
  const { action, consent, decision, decisionVerified, subscription, uid, expectedPlanId } = input;
  if (!subscription) return { allowed: false, outcome: "rejected", reason: "Unknown PayPal subscription." };
  if (subscription.planId !== expectedPlanId) return { allowed: false, outcome: "rejected", reason: "Subscription is not on the DevPilot AI Pro Monthly plan." };
  if (subscription.customId !== uid) return { allowed: false, outcome: "rejected", reason: "Subscription does not belong to this signed-in customer." };
  if (!consent) return { allowed: false, outcome: "rejected", reason: "Explicit customer consent is required." };

  if (action === "decline_offer") return { allowed: false, outcome: "no_paypal_change", reason: "Customer declined the offer; subscription unchanged." };
  if (action === "continue_cancellation") {
    if (subscription.status === "CANCELLED") return { allowed: false, outcome: "no_paypal_change", reason: "Subscription is already cancelled." };
    if (!["ACTIVE", "SUSPENDED"].includes(subscription.status)) return { allowed: false, outcome: "rejected", reason: `Subscription status ${subscription.status} cannot be cancelled.` };
    return { allowed: true, operation: "cancel", expectedStatus: "CANCELLED" };
  }
  // accept_offer
  if (!decision || !decisionVerified) return { allowed: false, outcome: "rejected", reason: "Offer could not be verified as issued by RETAIN.AI." };
  if (decision.status === "needs_approval") return { allowed: false, outcome: "awaiting_approval", reason: "Offer needs merchant approval before anything changes." };
  if (decision.status !== "offer" || !decision.offer) return { allowed: false, outcome: "rejected", reason: "There is no approved offer to accept." };
  return offerOperation(decision.offer, subscription.status);
}

function offerOperation(offer: Offer, status: string): Authorization {
  if (offer.type === "pause") {
    if (status !== "ACTIVE") return { allowed: false, outcome: "rejected", reason: `Only active subscriptions can be paused (status ${status}).` };
    return { allowed: true, operation: "suspend", expectedStatus: "SUSPENDED" };
  }
  // PayPal cannot apply an arbitrary discount, skip or downgrade to an existing
  // subscription without a plan revision the customer approves on PayPal.
  return { allowed: false, outcome: "pending_merchant_action", reason: `PayPal does not support applying a “${offer.type}” directly to an existing subscription. It needs a plan revision approved by the customer on PayPal.` };
}

export interface AuditEntry { at: string; kind: string; detail: string; verified?: boolean }

/** A subscription counts as retained only if PayPal confirms it is still active/suspended after an accepted offer. */
export function isVerifiedRetained(acceptedOffer: boolean, verifiedStatus: string | null) {
  return acceptedOffer && (verifiedStatus === "ACTIVE" || verifiedStatus === "SUSPENDED");
}

// --- Offer signing (WebCrypto HMAC; works on Workers and in tests) ---
const enc = new TextEncoder();
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
// Keys are sorted so the signature survives storage round-trips (Firestore reorders map keys).
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v;
const canonical = (uid: string, requestId: string, d: Decision) => JSON.stringify(stable([uid, requestId, d.status, d.offer ?? null]));
export const signDecision = (secret: string, uid: string, requestId: string, d: Decision) => hmac(secret, canonical(uid, requestId, d));
export async function verifyDecision(secret: string, uid: string, requestId: string, d: Decision, token: string) {
  const expected = await hmac(secret, canonical(uid, requestId, d));
  if (expected.length !== token.length) return false;
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
