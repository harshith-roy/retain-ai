import { describe, expect, it } from "vitest";
import { authorizeOperation, isVerifiedRetained, signDecision, verifyDecision } from "@/lib/paypal/journey";
import type { Decision } from "@/lib/retention/guardrails";

const PLAN = "P-DEVPILOT";
const uid = "user-1";
const sub = (status = "ACTIVE", over: Partial<{ planId: string; customId: string | null }> = {}) => ({ id: "I-ABCDEFGHIJKL", status, planId: PLAN, customId: uid, ...over });
const offer = (type: "pause" | "discount", status: Decision["status"] = "offer"): Decision => ({ status, offer: { type, discountPct: type === "discount" ? 20 : 0, durationMonths: 1, title: "t" }, message: "m cancel", rationale: "r", violations: [] } as Decision);
const base = { consent: true, decisionVerified: true, uid, expectedPlanId: PLAN };

describe("PayPal operation authorization", () => {
  it("cancels an active subscription when the customer continues cancellation", () => {
    expect(authorizeOperation({ ...base, action: "continue_cancellation", decision: null, subscription: sub() })).toEqual({ allowed: true, operation: "cancel", expectedStatus: "CANCELLED" });
  });
  it("never changes PayPal when the customer declines", () => {
    expect(authorizeOperation({ ...base, action: "decline_offer", decision: offer("pause"), subscription: sub() }).allowed).toBe(false);
  });
  it("suspends only for an accepted, verified pause offer", () => {
    expect(authorizeOperation({ ...base, action: "accept_offer", decision: offer("pause"), subscription: sub() })).toMatchObject({ allowed: true, operation: "suspend" });
    expect(authorizeOperation({ ...base, decisionVerified: false, action: "accept_offer", decision: offer("pause"), subscription: sub() })).toMatchObject({ allowed: false, outcome: "rejected" });
  });
  it("does not pretend a discount can be applied to an existing subscription", () => {
    expect(authorizeOperation({ ...base, action: "accept_offer", decision: offer("discount"), subscription: sub() })).toMatchObject({ allowed: false, outcome: "pending_merchant_action" });
  });
  it("holds offers that need merchant approval", () => {
    expect(authorizeOperation({ ...base, action: "accept_offer", decision: offer("pause", "needs_approval"), subscription: sub() })).toMatchObject({ allowed: false, outcome: "awaiting_approval" });
  });
  it("rejects unknown, foreign, wrong-plan or non-consented subscriptions", () => {
    expect(authorizeOperation({ ...base, action: "continue_cancellation", decision: null, subscription: null }).allowed).toBe(false);
    expect(authorizeOperation({ ...base, action: "continue_cancellation", decision: null, subscription: sub("ACTIVE", { customId: "someone-else" }) }).allowed).toBe(false);
    expect(authorizeOperation({ ...base, action: "continue_cancellation", decision: null, subscription: sub("ACTIVE", { planId: "P-OTHER" }) }).allowed).toBe(false);
    expect(authorizeOperation({ ...base, consent: false, action: "continue_cancellation", decision: null, subscription: sub() }).allowed).toBe(false);
  });
  it("does not re-cancel an already cancelled subscription (retry safety)", () => {
    expect(authorizeOperation({ ...base, action: "continue_cancellation", decision: null, subscription: sub("CANCELLED") })).toMatchObject({ allowed: false, outcome: "no_paypal_change" });
  });
  it("cannot pause a subscription that is not active", () => {
    expect(authorizeOperation({ ...base, action: "accept_offer", decision: offer("pause"), subscription: sub("SUSPENDED") }).allowed).toBe(false);
  });
});

describe("offer signatures", () => {
  it("accepts the server-issued offer and rejects a tampered one", async () => {
    const d = offer("discount");
    const t = await signDecision("secret", uid, "req", d);
    expect(await verifyDecision("secret", uid, "req", d, t)).toBe(true);
    const tampered = { ...d, offer: { ...d.offer!, discountPct: 90 } } as Decision;
    expect(await verifyDecision("secret", uid, "req", tampered, t)).toBe(false);
    expect(await verifyDecision("secret", "other-user", "req", d, t)).toBe(false);
  });
});

describe("retained revenue definition", () => {
  it("counts retained only when accepted and PayPal still reports the subscription live", () => {
    expect(isVerifiedRetained(true, "ACTIVE")).toBe(true);
    expect(isVerifiedRetained(true, null)).toBe(false);
    expect(isVerifiedRetained(true, "CANCELLED")).toBe(false);
    expect(isVerifiedRetained(false, "ACTIVE")).toBe(false);
  });
});

import { signDecision as _sign, verifyDecision as _verify } from "@/lib/paypal/journey";
import { it as _it, expect as _expect } from "vitest";
_it("offer signature still verifies after stored keys are reordered", async () => {
  const d = { status: "offer", offer: { type: "pause", discountPct: 0, title: "Pause", months: 1 }, message: "", rationale: "", violations: [] } as never;
  const tok = await _sign("s", "u", "r", d);
  const reordered = { ...(d as object), offer: { title: "Pause", months: 1, discountPct: 0, type: "pause" } } as never;
  _expect(await _verify("s", "u", "r", reordered, tok)).toBe(true);
});
