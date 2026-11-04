import { applyApproval, journeyFromDoc, sessionStatusFor } from "@/lib/records/model";
import { encode, decode } from "@/lib/firebase/admin.server";
import type { Decision } from "@/lib/retention/guardrails";

const pending: Decision = { status: "needs_approval", offer: { type: "discount", discountPct: 30, durationMonths: 3, title: "30% off" }, message: "m", rationale: "r", violations: [] } as unknown as Decision;

describe("session status", () => {
  it("accepted offer is not retained until PayPal verifies", () => {
    expect(sessionStatusFor({ decisionStatus: "offer", approval: "not_required", choice: "accepted", verifiedStatus: "ACTIVE", outcome: "pending_merchant_action" })).toBe("active");
  });
  it("retained only with PayPal-verified ACTIVE/SUSPENDED", () => {
    expect(sessionStatusFor({ decisionStatus: "offer", approval: null, choice: "accepted", verifiedStatus: "SUSPENDED", outcome: "verified" })).toBe("retained");
  });
  it("cancelled only when PayPal verifies CANCELLED", () => {
    expect(sessionStatusFor({ decisionStatus: "offer", approval: null, choice: "cancel", verifiedStatus: "ACTIVE", outcome: "paypal_failed" })).toBe("active");
    expect(sessionStatusFor({ decisionStatus: "offer", approval: null, choice: "cancel", verifiedStatus: "CANCELLED", outcome: "verified" })).toBe("cancelled");
  });
  it("pending approval is escalated", () => {
    expect(sessionStatusFor({ decisionStatus: "needs_approval", approval: "pending", choice: null, verifiedStatus: null, outcome: null })).toBe("escalated");
  });
});

describe("approvals", () => {
  it("approval makes the offer available", () => expect(applyApproval(pending, "approved").status).toBe("offer"));
  it("rejection withdraws the offer", () => { const d = applyApproval(pending, "rejected"); expect(d.status).toBe("no_offer"); expect(d.offer).toBeNull(); });
  it("cannot re-decide an offer that is not pending", () => expect(() => applyApproval({ ...pending, status: "offer" } as unknown as Decision, "approved")).toThrow());
});

describe("journey + encoding", () => {
  it("sorts activity newest first", () => {
    const j = journeyFromDoc({ activity: [{ id: "a", at: "2026-01-01T00:00:00.000Z", kind: "x", detail: "" }, { id: "b", at: "2026-02-01T00:00:00.000Z", kind: "y", detail: "" }] });
    expect(j.audit.map((a) => a.id)).toEqual(["b", "a"]);
  });
  it("round-trips Firestore values", () => {
    const v = { a: 1, b: 1.5, c: "x", d: [true, null], e: { f: "2026-01-01T00:00:00.000Z" } };
    expect(decode(encode(v))).toEqual(v);
  });
});
