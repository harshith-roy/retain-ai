import { describe, expect, it } from "vitest";
import { RATE_LIMITS, canDecideApproval, canManageTeam, decideSignup, emailAllowed, overLimit, parseAllowlist, rateBuckets } from "@/lib/security/access";

describe("approval authorization", () => {
  it("blocks a customer approving their own retention offer, even as workspace owner", () => {
    const v = canDecideApproval({ approverUid: "alice", role: "owner", sessionCustomerUid: "alice" });
    expect(v.ok).toBe(false);
  });
  it("blocks members without an approver role", () => {
    expect(canDecideApproval({ approverUid: "eve", role: "viewer", sessionCustomerUid: "carol" }).ok).toBe(false);
    expect(canDecideApproval({ approverUid: "eve", role: "", sessionCustomerUid: "carol" }).ok).toBe(false);
  });
  it("blocks approvals with no customer on record", () => {
    expect(canDecideApproval({ approverUid: "alice", role: "owner", sessionCustomerUid: null }).ok).toBe(false);
  });
  it("allows the owner or an invited approver to decide another customer's offer", () => {
    expect(canDecideApproval({ approverUid: "alice", role: "owner", sessionCustomerUid: "carol" }).ok).toBe(true);
    expect(canDecideApproval({ approverUid: "bob", role: "approver", sessionCustomerUid: "carol" }).ok).toBe(true);
  });
  it("lets only owners manage the team", () => {
    expect(canManageTeam("owner").ok).toBe(true);
    expect(canManageTeam("approver").ok).toBe(false);
  });
});

describe("merchant sign-up access", () => {
  const now = new Date("2026-11-03T00:00:00Z");
  const base = { existingMember: false, email: "new@acme.com", emailVerified: true, invite: null, allowlist: [] as string[], now };
  it("always keeps existing members (project owner, QA accounts) signed in", () => {
    expect(decideSignup({ ...base, existingMember: true, emailVerified: false, email: "" }).kind).toBe("existing");
  });
  it("denies open Google sign-up without invite or allow-list", () => {
    expect(decideSignup(base).kind).toBe("denied");
  });
  it("denies unverified emails even when allow-listed", () => {
    expect(decideSignup({ ...base, emailVerified: false, allowlist: ["new@acme.com"] }).kind).toBe("denied");
  });
  it("lets allow-listed emails or domains create their own workspace", () => {
    expect(decideSignup({ ...base, allowlist: parseAllowlist("new@acme.com") }).kind).toBe("create_owner");
    expect(decideSignup({ ...base, allowlist: parseAllowlist("@acme.com, other@x.io") }).kind).toBe("create_owner");
    expect(emailAllowed("new@acme.com.evil.io", parseAllowlist("@acme.com"))).toBe(false);
  });
  it("joins the inviting workspace as approver with a valid pending invite", () => {
    const d = decideSignup({ ...base, invite: { merchantId: "m1", role: "approver", status: "pending", expiresAt: "2026-11-10T00:00:00Z" } });
    expect(d).toEqual({ kind: "join", merchantId: "m1", role: "approver" });
  });
  it("ignores expired, revoked or owner-role invites", () => {
    expect(decideSignup({ ...base, invite: { merchantId: "m1", role: "approver", status: "pending", expiresAt: "2026-11-01T00:00:00Z" } }).kind).toBe("denied");
    expect(decideSignup({ ...base, invite: { merchantId: "m1", role: "approver", status: "revoked", expiresAt: null } }).kind).toBe("denied");
    expect(decideSignup({ ...base, invite: { merchantId: "m1", role: "owner", status: "pending", expiresAt: null } }).kind).toBe("denied");
  });
});

describe("AI and voice usage limits", () => {
  const now = new Date("2026-11-03T04:30:00Z");
  it("uses per-user and per-workspace hourly buckets from verified identity", () => {
    const b = rateBuckets("generate_offer", "alice", "m1", now);
    expect(b.map((x) => x.key)).toEqual([`generate_offer_u_alice_${Math.floor(now.getTime() / 3600000)}`, `generate_offer_m_m1_${Math.floor(now.getTime() / 3600000)}`]);
  });
  it("applies the agreed hourly caps", () => {
    expect(RATE_LIMITS.analyze_website).toEqual([{ per: "user", max: 10 }, { per: "workspace", max: 30 }]);
    expect(RATE_LIMITS.generate_offer).toEqual([{ per: "user", max: 30 }, { per: "workspace", max: 120 }]);
    expect(RATE_LIMITS.voice).toEqual([{ per: "user", max: 30 }, { per: "workspace", max: 120 }]);
  });
  it("blocks the request that exceeds either cap", () => {
    expect(overLimit([{ max: 10, count: 10 }, { max: 30, count: 5 }])).toBe(false);
    expect(overLimit([{ max: 10, count: 11 }, { max: 30, count: 5 }])).toBe(true);
    expect(overLimit([{ max: 10, count: 1 }, { max: 30, count: 31 }])).toBe(true);
  });
  it("starts a fresh bucket next hour", () => {
    const a = rateBuckets("voice", "u", "m", now)[0]!.key;
    const b = rateBuckets("voice", "u", "m", new Date(now.getTime() + 3600_000))[0]!.key;
    expect(a).not.toBe(b);
  });
});
