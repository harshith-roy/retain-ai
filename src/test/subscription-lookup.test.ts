import { describe, expect, it } from "vitest";
import { INVALID_ID, NOT_FOUND, SIGN_IN_REQUIRED, lookupOwnedSubscription, type LookupDeps } from "@/lib/paypal/subscription-lookup";

const subs: Record<string, any> = {
  "I-OWNED00001": { id: "I-OWNED00001", status: "ACTIVE", planId: "P-1", customId: "alice", raw: { billing_info: { next_billing_time: "2026-12-01T00:00:00Z", last_payment: { amount: { value: "29.00", currency_code: "USD" }, time: "2026-11-01T00:00:00Z" } } } },
  "I-OTHER00001": { id: "I-OTHER00001", status: "ACTIVE", planId: "P-1", customId: "bob", raw: { billing_info: { next_billing_time: "2026-12-05T00:00:00Z" } } },
};
let paypalCalls = 0;
const deps: LookupDeps = {
  verifyUser: async (t) => { if (t !== "alice-token") throw new Error("bad token"); return "alice"; },
  isSubscriptionId: (id) => /^I-[A-Z0-9]{10,}$/.test(id),
  getSubscription: async (id) => { paypalCalls++; return subs[id] ?? null; },
  getPlanPrice: async () => ({ amount: 29, currency: "USD" }),
};

describe("ownership-bound subscription lookup", () => {
  it("returns details for the user's own subscription", async () => {
    const r = await lookupOwnedSubscription(deps, "alice-token", "I-OWNED00001");
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.subscription.status).toBe("ACTIVE"); expect(r.subscription.amount).toBe(29); expect(r.subscription.lastPayment?.amount).toBe("29.00"); }
  });

  it("returns only a generic not-found for another user's subscription", async () => {
    const r = await lookupOwnedSubscription(deps, "alice-token", "I-OTHER00001");
    expect(r).toEqual({ ok: false, error: NOT_FOUND });
    expect(JSON.stringify(r)).not.toMatch(/ACTIVE|P-1|2026|29/);
  });

  it("gives the same answer for a subscription that does not exist", async () => {
    expect(await lookupOwnedSubscription(deps, "alice-token", "I-MISSING0001")).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("rejects an invalid subscription ID without calling PayPal", async () => {
    const before = paypalCalls;
    expect(await lookupOwnedSubscription(deps, "alice-token", "P-NOTASUB")).toEqual({ ok: false, error: INVALID_ID });
    expect(paypalCalls).toBe(before);
  });

  it("refuses unauthenticated requests without calling PayPal", async () => {
    const before = paypalCalls;
    expect(await lookupOwnedSubscription(deps, "", "I-OWNED00001")).toEqual({ ok: false, error: SIGN_IN_REQUIRED });
    expect(await lookupOwnedSubscription(deps, "forged", "I-OWNED00001")).toEqual({ ok: false, error: SIGN_IN_REQUIRED });
    expect(paypalCalls).toBe(before);
  });
});
