import { describe, expect, it } from "vitest";
import { canStartCheckout, DEVPILOT } from "@/lib/paypal/journey";

describe("DevPilot checkout eligibility", () => {
  it("allows checkout when no subscription exists", () => {
    expect(canStartCheckout(false, null, true)).toBe(true);
  });
  it("allows a new checkout after a cancelled subscription", () => {
    expect(canStartCheckout(true, "CANCELLED", true)).toBe(true);
  });
  it("allows a new checkout after an expired subscription", () => {
    expect(canStartCheckout(true, "EXPIRED", true)).toBe(true);
  });
  it("does not offer duplicate checkout for active subscriptions", () => {
    expect(canStartCheckout(true, "ACTIVE", true)).toBe(false);
  });
  it("preserves management of paused and pending subscriptions", () => {
    for (const status of ["SUSPENDED", "APPROVAL_PENDING", "APPROVED"]) {
      expect(canStartCheckout(true, status, true)).toBe(false);
    }
  });
  it("does not treat an unknown existing status as absence of a subscription", () => {
    expect(canStartCheckout(true, null, true)).toBe(false);
  });
  it("does not enable checkout before journey and status loading finish", () => {
    expect(canStartCheckout(false, null, false)).toBe(false);
    expect(canStartCheckout(true, "CANCELLED", false)).toBe(false);
  });
  it("offers DevPilot AI Pro Monthly at 29 USD per month", () => {
    expect(DEVPILOT.monthlyPrice).toBe(29);
    expect(DEVPILOT.currency).toBe("USD");
  });
});