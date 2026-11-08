import { describe, expect, it } from "vitest";
import {
  authorizeOperation,
  isVerifiedRetained,
  signDecision,
  verifyDecision,
  verifyRevision,
} from "@/lib/paypal/journey";
import type { Decision } from "@/lib/retention/guardrails";

const PLAN = "P-DEVPILOT";
const uid = "user-1";
const sub = (
  status = "ACTIVE",
  over: Partial<{ planId: string; customId: string | null }> = {},
) => ({ id: "I-ABCDEFGHIJKL", status, planId: PLAN, customId: uid, ...over });
const offer = (type: "pause" | "discount", status: Decision["status"] = "offer"): Decision =>
  ({
    status,
    offer: { type, discountPct: type === "discount" ? 20 : 0, durationMonths: 1, title: "t" },
    message: "m cancel",
    rationale: "r",
    violations: [],
  }) as Decision;
const base = { consent: true, decisionVerified: true, uid, expectedPlanId: PLAN };

describe("PayPal operation authorization", () => {
  it("cancels an active subscription when the customer continues cancellation", () => {
    expect(
      authorizeOperation({
        ...base,
        action: "continue_cancellation",
        decision: null,
        subscription: sub(),
      }),
    ).toEqual({ allowed: true, operation: "cancel", expectedStatus: "CANCELLED" });
  });
  it("never changes PayPal when the customer declines", () => {
    expect(
      authorizeOperation({
        ...base,
        action: "decline_offer",
        decision: offer("pause"),
        subscription: sub(),
      }).allowed,
    ).toBe(false);
  });
  it("suspends only for an accepted, verified pause offer", () => {
    expect(
      authorizeOperation({
        ...base,
        action: "accept_offer",
        decision: offer("pause"),
        subscription: sub(),
      }),
    ).toMatchObject({ allowed: true, operation: "suspend" });
    expect(
      authorizeOperation({
        ...base,
        decisionVerified: false,
        action: "accept_offer",
        decision: offer("pause"),
        subscription: sub(),
      }),
    ).toMatchObject({ allowed: false, outcome: "rejected" });
  });
  it("revises the billing cycle for an accepted, verified discount offer", () => {
    expect(
      authorizeOperation({
        ...base,
        action: "accept_offer",
        decision: offer("discount"),
        subscription: sub(),
      }),
    ).toEqual({ allowed: true, operation: "revise", expectedStatus: "ACTIVE" });
  });
  it("rejects a discount with no discount to apply", () => {
    const d = offer("discount");
    d.offer = { ...d.offer!, discountPct: 0 };
    expect(
      authorizeOperation({
        ...base,
        action: "accept_offer",
        decision: d,
        subscription: sub(),
      }),
    ).toMatchObject({ allowed: false, outcome: "rejected" });
  });
  it("still needs a customer-approved plan for downgrades and skips", () => {
    expect(
      authorizeOperation({
        ...base,
        action: "accept_offer",
        decision: {
          ...offer("discount"),
          offer: { type: "downgrade", discountPct: 0, durationMonths: 1, title: "t" },
        } as Decision,
        subscription: sub(),
      }),
    ).toMatchObject({ allowed: false, outcome: "pending_merchant_action" });
  });
  it("treats a legacy approval-pending offer as auto-approved", () => {
    expect(
      authorizeOperation({
        ...base,
        action: "accept_offer",
        decision: offer("pause", "needs_approval"),
        subscription: sub(),
      }),
    ).toMatchObject({ allowed: true, operation: "suspend" });
  });
  it("rejects unknown, foreign, wrong-plan or non-consented subscriptions", () => {
    expect(
      authorizeOperation({
        ...base,
        action: "continue_cancellation",
        decision: null,
        subscription: null,
      }).allowed,
    ).toBe(false);
    expect(
      authorizeOperation({
        ...base,
        action: "continue_cancellation",
        decision: null,
        subscription: sub("ACTIVE", { customId: "someone-else" }),
      }).allowed,
    ).toBe(false);
    expect(
      authorizeOperation({
        ...base,
        action: "continue_cancellation",
        decision: null,
        subscription: sub("ACTIVE", { planId: "P-OTHER" }),
      }).allowed,
    ).toBe(false);
    expect(
      authorizeOperation({
        ...base,
        consent: false,
        action: "continue_cancellation",
        decision: null,
        subscription: sub(),
      }).allowed,
    ).toBe(false);
  });
  it("does not re-cancel an already cancelled subscription (retry safety)", () => {
    expect(
      authorizeOperation({
        ...base,
        action: "continue_cancellation",
        decision: null,
        subscription: sub("CANCELLED"),
      }),
    ).toMatchObject({ allowed: false, outcome: "no_paypal_change" });
  });
  it("cannot pause a subscription that is not active", () => {
    expect(
      authorizeOperation({
        ...base,
        action: "accept_offer",
        decision: offer("pause"),
        subscription: sub("SUSPENDED"),
      }).allowed,
    ).toBe(false);
  });
});

describe("revision verification", () => {
  const expected = { planId: PLAN, price: "40.00", currency: "USD", durationMonths: 3 };
  const snapshot = (status = "ACTIVE", discountedPrice = "40.00") => ({
    status,
    planId: PLAN,
    raw: {
      plan_overridden: true,
      plan: {
        billing_cycles: [
          {
            sequence: 1,
            tenure_type: "REGULAR",
            total_cycles: 0,
            pricing_scheme: { fixed_price: { value: discountedPrice, currency_code: "USD" } },
          },
        ],
      },
    },
  });

  it("accepts an ACTIVE subscription exposing the discounted cycle", () => {
    const r = verifyRevision(snapshot(), expected);
    expect(r.verified).toBe(true);
    expect(r.effectivePrice).toBe(40);
  });
  it("rejects a subscription that is no longer ACTIVE", () => {
    expect(verifyRevision(snapshot("SUSPENDED"), expected).verified).toBe(false);
  });
  it("rejects a missing or different discounted cycle", () => {
    expect(verifyRevision(null, expected).verified).toBe(false);
    expect(verifyRevision(snapshot("ACTIVE", "45.00"), expected).verified).toBe(false);
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
  const d = {
    status: "offer",
    offer: { type: "pause", discountPct: 0, title: "Pause", months: 1 },
    message: "",
    rationale: "",
    violations: [],
  } as never;
  const tok = await _sign("s", "u", "r", d);
  const reordered = {
    ...(d as object),
    offer: { title: "Pause", months: 1, discountPct: 0, type: "pause" },
  } as never;
  _expect(await _verify("s", "u", "r", reordered, tok)).toBe(true);
});
