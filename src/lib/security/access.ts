/**
 * Pure access decisions (no I/O) so every rule is unit-tested. Server
 * functions load the facts (membership, session, invite) and ask these.
 */

export type MerchantRole = "owner" | "approver";
export const APPROVER_ROLES: readonly MerchantRole[] = ["owner", "approver"];
export const INVITABLE_ROLES: readonly MerchantRole[] = ["approver"];

export type Verdict = { ok: true } | { ok: false; error: string };

/** Approve/reject a retention offer: merchant team only, never the customer it is for. */
export function canDecideApproval(input: { approverUid: string; role: string; sessionCustomerUid: string | null | undefined }): Verdict {
  if (!APPROVER_ROLES.includes(input.role as MerchantRole)) return { ok: false, error: "Only the workspace owner or an invited approver can decide approvals." };
  if (!input.sessionCustomerUid) return { ok: false, error: "This approval has no customer on record and cannot be decided." };
  if (input.sessionCustomerUid === input.approverUid) return { ok: false, error: "You can't approve an offer made to your own subscription. Another team member must decide it." };
  return { ok: true };
}

/** Managing invites is owner-only. */
export function canManageTeam(role: string): Verdict {
  return role === "owner" ? { ok: true } : { ok: false, error: "Only the workspace owner can manage the team." };
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

/** Allow-list entries: full emails ("a@b.com") or whole domains ("@b.com"). */
export function parseAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? "").split(/[,\s]+/).map(normalizeEmail).filter((x) => x.length > 2 && x.includes("@"));
}
export function emailAllowed(email: string, allowlist: string[]): boolean {
  const e = normalizeEmail(email);
  if (!e.includes("@")) return false;
  const domain = e.slice(e.indexOf("@"));
  return allowlist.some((a) => (a.startsWith("@") ? a === domain : a === e));
}

export interface InviteFacts { merchantId: string; role: string; status: string; expiresAt: string | null }
export type SignupDecision =
  | { kind: "existing" }
  | { kind: "join"; merchantId: string; role: MerchantRole }
  | { kind: "create_owner" }
  | { kind: "denied"; error: string };

/**
 * Who may get a workspace. Existing members always keep access, so the
 * project owner and current QA accounts are never locked out.
 */
export function decideSignup(input: { existingMember: boolean; email: string; emailVerified: boolean; invite: InviteFacts | null; allowlist: string[]; now: Date }): SignupDecision {
  if (input.existingMember) return { kind: "existing" };
  if (!input.email || !input.emailVerified) return { kind: "denied", error: "Your Google email must be verified to join RETAIN.AI." };
  const inv = input.invite;
  if (inv && inv.status === "pending" && (!inv.expiresAt || new Date(inv.expiresAt) > input.now) && INVITABLE_ROLES.includes(inv.role as MerchantRole)) {
    return { kind: "join", merchantId: inv.merchantId, role: inv.role as MerchantRole };
  }
  if (emailAllowed(input.email, input.allowlist)) return { kind: "create_owner" };
  return { kind: "denied", error: "RETAIN.AI is invitation-only. Ask a workspace owner to invite this email address." };
}

// --- Rate limits ---
export interface Limit { per: "user" | "workspace"; max: number }
export const WINDOW_SECONDS = 3600;
export const RATE_LIMITS = {
  analyze_website: [{ per: "user", max: 10 }, { per: "workspace", max: 30 }],
  generate_offer: [{ per: "user", max: 30 }, { per: "workspace", max: 120 }],
  voice: [{ per: "user", max: 30 }, { per: "workspace", max: 120 }],
} as const satisfies Record<string, readonly Limit[]>;
export type RateAction = keyof typeof RATE_LIMITS;

/** Bucket keys derive only from server-verified identity, never browser input. */
export function rateBuckets(action: RateAction, uid: string, merchantId: string, now: Date) {
  const window = Math.floor(now.getTime() / 1000 / WINDOW_SECONDS);
  return RATE_LIMITS[action].map((l) => ({ ...l, key: `${action}_${l.per === "user" ? `u_${uid}` : `m_${merchantId}`}_${window}` }));
}
export function overLimit(counts: { max: number; count: number }[]): boolean {
  return counts.some((c) => c.count > c.max);
}
