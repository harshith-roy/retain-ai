import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyFirebaseIdentity } from "@/lib/retention/providers.server";
import { BrandProfileSchema, PolicySchema, type Decision } from "@/lib/retention/guardrails";
import { signDecision } from "@/lib/paypal/journey";
import {
  canDecideApproval,
  canManageTeam,
  decideSignup,
  normalizeEmail,
} from "@/lib/security/access";
import { applyApproval, sessionStatusFor, type ActivityEntry, type JourneyView } from "./model";

const token = z.string().min(20).max(4096);
const fail = (e: unknown) => ({
  ok: false as const,
  error: e instanceof Error ? e.message : "Request failed.",
});
const srv = () => import("./records.server");

/** Current DevPilot journey for the signed-in customer, joined with its persisted session. */
export const getJourney = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ idToken: token }).parse(d))
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; journey: JourneyView } | { ok: false; error: string }> => {
      try {
        const who = await verifyFirebaseIdentity(data.idToken);
        const r = await srv();
        const { merchantId } = await r.resolveMerchant(who.uid);
        const j = await r.readJourney(merchantId, who.uid);
        if (j.currentSessionId) {
          const sess = await r.readSession(merchantId, j.currentSessionId);
          if (sess) {
            j.decision = (sess["decision"] as unknown as Decision) ?? null;
            j.approval = (sess["approval"] as JourneyView["approval"]) ?? null;
          }
        }
        return { ok: true, journey: j };
      } catch (e) {
        return fail(e);
      }
    },
  );

/** Bind a PayPal subscription only after PayPal confirms it exists and belongs to this user. */
export const bindSubscription = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        idToken: token,
        subscriptionId: z.string().max(40),
        event: z.enum(["approved_return", "refresh", "legacy_import"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const who = await verifyFirebaseIdentity(data.idToken);
      const r = await srv();
      const { merchantId } = await r.resolveMerchant(who.uid);
      const pp = await import("@/lib/paypal/paypal.server");
      if (!pp.isSubscriptionId(data.subscriptionId))
        return { ok: false as const, error: "That is not a PayPal subscription ID." };
      const sub = await pp.getSubscription(data.subscriptionId);
      if (!sub) return { ok: false as const, error: "PayPal has no subscription with that ID." };
      if (sub.customId !== who.uid)
        return {
          ok: false as const,
          error: "This PayPal subscription does not belong to your account.",
        };
      const { currentCyclePrice } = await import("@/lib/paypal/subscription-lookup");
      const price =
        currentCyclePrice(sub.raw) ?? (await pp.getPlanPrice(sub.planId).catch(() => null));
      const entries: ActivityEntry[] =
        data.event === "refresh"
          ? []
          : [
              r.activity(
                data.event === "approved_return"
                  ? "paypal_approved"
                  : "legacy_subscription_imported",
                `PayPal confirms subscription ${sub.id} is ${sub.status}.`,
                true,
              ),
            ];
      await r.upsertVerifiedSubscription(
        merchantId,
        who,
        {
          id: sub.id,
          status: sub.status,
          amount: price?.amount ?? null,
          startTime: sub.raw.start_time ?? null,
        },
        ...entries,
      );
      if (data.event === "approved_return")
        await (
          await import("@/lib/firebase/admin.server")
        ).commit([r.journeyWrite(merchantId, who.uid, { pendingSubscriptionId: null })]);
      return { ok: true as const, status: sub.status };
    } catch (e) {
      return fail(e);
    }
  });

export const logPaypalReturnCancelled = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ idToken: token }).parse(d))
  .handler(async ({ data }) => {
    try {
      const who = await verifyFirebaseIdentity(data.idToken);
      const r = await srv();
      const { merchantId } = await r.resolveMerchant(who.uid);
      const { commit } = await import("@/lib/firebase/admin.server");
      await commit([
        r.journeyWrite(
          merchantId,
          who.uid,
          { pendingSubscriptionId: null },
          r.activity("paypal_approval_cancelled", "Customer left PayPal without approving."),
        ),
      ]);
      return { ok: true as const };
    } catch (e) {
      return fail(e);
    }
  });

/** Detach the demo subscription from the journey. PayPal and stored records are never deleted. */
export const resetJourney = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ idToken: token }).parse(d))
  .handler(async ({ data }) => {
    try {
      const who = await verifyFirebaseIdentity(data.idToken);
      const r = await srv();
      const { merchantId } = await r.resolveMerchant(who.uid);
      const { commit } = await import("@/lib/firebase/admin.server");
      await commit([
        r.journeyWrite(
          merchantId,
          who.uid,
          {
            pendingSubscriptionId: null,
            currentSessionId: null,
            offersMade: 0,
            customerChoice: null,
            paypalOutcome: null,
            paypalReason: null,
            verifiedStatus: null,
            verifiedAt: null,
          },
          r.activity(
            "demo_reset",
            "Started a new demo journey. The PayPal subscription stays connected; earlier records were left unchanged.",
          ),
        ),
      ]);
      return { ok: true as const };
    } catch (e) {
      return fail(e);
    }
  });

/** One-time import of a browser-only journey's history, clearly labelled unverified. */
export const importBrowserHistory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        idToken: token,
        entries: z
          .array(
            z.object({
              at: z.string().datetime(),
              kind: z.string().max(60),
              detail: z.string().max(600),
            }),
          )
          .max(100),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const who = await verifyFirebaseIdentity(data.idToken);
      const r = await srv();
      const { merchantId } = await r.resolveMerchant(who.uid);
      const c = await r.claim(merchantId, `legacy_import_${who.uid}`);
      if (!c.fresh) return { ok: true as const, imported: 0 };
      const { commit } = await import("@/lib/firebase/admin.server");
      const entries = data.entries.map((e) => ({
        id: crypto.randomUUID(),
        at: e.at,
        kind: `browser_${e.kind}`.slice(0, 70),
        detail: `Imported from browser history (not verified): ${e.detail}`,
        verified: false,
      }));
      await commit([
        r.journeyWrite(merchantId, who.uid, {}, ...entries),
        r.finishClaim(merchantId, `legacy_import_${who.uid}`, { imported: entries.length }),
      ]);
      return { ok: true as const, imported: entries.length };
    } catch (e) {
      return fail(e);
    }
  });

// --- Merchant settings ---
const SettingsInput = z.object({
  idToken: token,
  profile: BrandProfileSchema.nullable(),
  profileApproved: z.boolean(),
  policy: PolicySchema,
});

export const getRetentionSettings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ idToken: token }).parse(d))
  .handler(async ({ data }) => {
    try {
      const who = await verifyFirebaseIdentity(data.idToken);
      const r = await srv();
      const { merchantId } = await r.resolveMerchant(who.uid);
      const s = await r.readSettings(merchantId);
      const policy = PolicySchema.safeParse(s?.["policy"]);
      const profile = BrandProfileSchema.safeParse(s?.["profile"]);
      return {
        ok: true as const,
        exists: !!s,
        policy: policy.success ? policy.data : null,
        profile: profile.success ? profile.data : null,
        profileApproved: s?.["profileApproved"] === true && profile.success,
        updatedAt: (s?.["updatedAt"] as string | undefined) ?? null,
      };
    } catch (e) {
      return fail(e);
    }
  });

export const saveRetentionSettings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SettingsInput.parse(d))
  .handler(async ({ data }) => {
    try {
      const who = await verifyFirebaseIdentity(data.idToken);
      const r = await srv();
      const { merchantId, role } = await r.resolveMerchant(who.uid);
      if (role !== "owner")
        return {
          ok: false as const,
          error: "Only the workspace owner can change retention settings.",
        };
      const { commit } = await import("@/lib/firebase/admin.server");
      await commit([
        {
          op: "set",
          path: `merchants/${merchantId}/settings/retention`,
          data: {
            policy: data.policy,
            profile: data.profile,
            profileApproved: data.profileApproved && !!data.profile,
            updatedAt: new Date().toISOString(),
            updatedBy: who.uid,
          },
        },
      ]);
      return { ok: true as const };
    } catch (e) {
      return fail(e);
    }
  });

// --- Human approvals ---
export const decideApproval = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        idToken: token,
        approvalId: z.string().uuid(),
        outcome: z.enum(["approved", "rejected"]),
        note: z.string().max(300).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const who = await verifyFirebaseIdentity(data.idToken);
      const r = await srv();
      const { merchantId, role } = await r.resolveMerchant(who.uid);
      // Authorize before claiming, so a refused attempt can't block the real approver.
      const sess = await r.readSession(merchantId, data.approvalId);
      const verdict = canDecideApproval({
        approverUid: who.uid,
        role,
        sessionCustomerUid: sess ? String(sess["customerUid"] ?? "") : null,
      });
      if (!sess) return { ok: false as const, error: "This approval is no longer pending." };
      if (!verdict.ok) return { ok: false as const, error: verdict.error };
      const c = await r.claim(merchantId, `approval_${data.approvalId}`);
      if (!c.fresh)
        return {
          ok: true as const,
          duplicate: true,
          outcome: (c.result as { outcome?: string } | null)?.outcome ?? "processing",
        };
      const { commit, getDoc } = await import("@/lib/firebase/admin.server");
      const approval = await getDoc(`merchants/${merchantId}/approvals/${data.approvalId}`);
      if (!approval || !sess || approval["status"] !== "pending") {
        await commit([
          r.finishClaim(merchantId, `approval_${data.approvalId}`, { outcome: "invalid" }),
        ]);
        return { ok: false as const, error: "This approval is no longer pending." };
      }
      const stored = sess["decision"] as unknown as Decision;
      const decision = applyApproval(stored, data.outcome);
      const wasEscalation = stored.status === "escalated";
      const secret = process.env["RETAIN_SIGNING_SECRET"];
      if (!secret) throw new Error("Server signing key is not configured.");
      const customerUid = String(sess["customerUid"]);
      const tok = await signDecision(secret, customerUid, data.approvalId, decision);
      const now = new Date().toISOString();
      const entry = r.activity(
        data.outcome === "approved" ? "approval_granted" : "approval_rejected",
        `${who.name} ${data.outcome} the request${data.note ? `: ${data.note}` : "."}`,
      );
      await commit([
        {
          op: "merge",
          path: `merchants/${merchantId}/approvals/${data.approvalId}`,
          data: { status: data.outcome, decidedBy: who.uid, decidedAt: now, note: data.note },
        },
        {
          op: "merge",
          path: `merchants/${merchantId}/retentionSessions/${data.approvalId}`,
          data: {
            decision: decision as unknown as Record<string, unknown>,
            decisionToken: tok,
            approval: data.outcome,
            offer: decision.offer?.title ?? "No offer",
            status: sessionStatusFor({
              decisionStatus: decision.status,
              approval: data.outcome,
              choice: null,
              verifiedStatus: null,
              outcome: null,
            }),
          },
          append: { activity: [entry] },
        },
        r.journeyWrite(merchantId, customerUid, {}, entry),
        r.finishClaim(merchantId, `approval_${data.approvalId}`, { outcome: data.outcome }),
      ]);
      const n = await import("@/lib/notify/notify.server");
      await n.capture("approval_decided", merchantId, {
        approvalId: data.approvalId,
        outcome: data.outcome,
        decidedBy: who.uid,
      });
      await n.slackPost(
        `${who.name} ${data.outcome} the ${wasEscalation ? "escalation" : "retention offer"} for ${String(sess["customerName"] ?? "a customer")}.`,
      );
      return { ok: true as const, duplicate: false, outcome: data.outcome };
    } catch (e) {
      return fail(e);
    }
  });

// --- Merchant access: invitation / allow-list onboarding ---
const sha = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const invitePath = async (email: string) => `merchantInvites/${await sha(normalizeEmail(email))}`;
const teamPath = (m: string) => `merchants/${m}/settings/team`;
type TeamInvite = {
  email: string;
  role: string;
  status: string;
  invitedAt: string;
  expiresAt: string;
  acceptedUid?: string;
};
async function readTeam(m: string): Promise<Record<string, TeamInvite>> {
  const { getDoc } = await import("@/lib/firebase/admin.server");
  return ((await getDoc(teamPath(m)))?.["invites"] as unknown as Record<string, TeamInvite>) ?? {};
}

/**
 * Called after Google sign-in. Existing members keep their workspace, pending
 * invitations join the inviting workspace, and everyone else gets a new one.
 */
export const provisionWorkspace = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ idToken: token }).parse(d))
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; merchantId: string; role: string }
      | { ok: false; error: string; denied?: boolean }
    > => {
      try {
        const who = await verifyFirebaseIdentity(data.idToken);
        const { getDoc, commit } = await import("@/lib/firebase/admin.server");
        const existing = await getDoc(`merchantUsers/${who.uid}`);
        const ip = who.email ? await invitePath(who.email) : null;
        const inv = ip ? await getDoc(ip) : null;
        const decision = decideSignup({
          existingMember: !!existing,
          invite: inv
            ? {
                merchantId: String(inv["merchantId"] ?? ""),
                role: String(inv["role"] ?? ""),
                status: String(inv["status"] ?? ""),
                expiresAt: (inv["expiresAt"] as string | null) ?? null,
              }
            : null,
          now: new Date(),
        });
        const now = new Date().toISOString();
        const profile = {
          uid: who.uid,
          displayName: who.name,
          email: who.email,
          photoURL: "",
          createdAt: now,
        };
        if (decision.kind === "existing") {
          const m = await (await srv()).resolveMerchant(who.uid);
          return { ok: true, ...m };
        }
        if (decision.kind === "create_owner") {
          if (await getDoc(`merchants/${who.uid}`))
            return {
              ok: false,
              error: "Your workspace records need administrator attention. No changes were made.",
            };
          const created = await commit([
            {
              op: "create",
              path: `merchants/${who.uid}`,
              data: { ownerUid: who.uid, name: `${who.name}'s workspace`, createdAt: now },
            },
            {
              op: "create",
              path: `merchantUsers/${who.uid}`,
              data: { ...profile, merchantId: who.uid, role: "owner" },
            },
          ]);
          if (!created)
            return { ok: false, error: "Your workspace is already being set up. Please refresh." };
          return { ok: true, merchantId: who.uid, role: "owner" };
        }
        // join via invite
        if (!(await getDoc(`merchants/${decision.merchantId}`)))
          return {
            ok: false,
            denied: true,
            error: "The workspace that invited you no longer exists.",
          };
        const team = await readTeam(decision.merchantId);
        const key = (ip as string).split("/")[1] as string;
        if (team[key]) team[key] = { ...team[key], status: "accepted", acceptedUid: who.uid };
        const joined = await commit([
          {
            op: "create",
            path: `merchantUsers/${who.uid}`,
            data: { ...profile, merchantId: decision.merchantId, role: decision.role },
          },
          {
            op: "merge",
            path: ip as string,
            data: { status: "accepted", acceptedUid: who.uid, acceptedAt: now },
          },
          {
            op: "set",
            path: teamPath(decision.merchantId),
            data: { invites: team, updatedAt: now },
          },
        ]);
        if (!joined) return { ok: false, error: "Your account is already linked. Please refresh." };
        return { ok: true, merchantId: decision.merchantId, role: decision.role };
      } catch (e) {
        return fail(e);
      }
    },
  );

export const getTeam = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ idToken: token }).parse(d))
  .handler(async ({ data }) => {
    try {
      const who = await verifyFirebaseIdentity(data.idToken);
      const { merchantId, role } = await (await srv()).resolveMerchant(who.uid);
      const v = canManageTeam(role);
      if (!v.ok) return { ok: false as const, error: v.error };
      const invites = Object.entries(await readTeam(merchantId)).map(([id, i]) => ({
        id,
        email: i.email,
        role: i.role,
        status: i.status,
        invitedAt: i.invitedAt,
        expiresAt: i.expiresAt,
      }));
      return { ok: true as const, invites };
    } catch (e) {
      return fail(e);
    }
  });

export const inviteMember = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        idToken: token,
        email: z.string().trim().email().max(200),
        role: z.enum(["approver"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const who = await verifyFirebaseIdentity(data.idToken);
      const { merchantId, role } = await (await srv()).resolveMerchant(who.uid);
      const v = canManageTeam(role);
      if (!v.ok) return { ok: false as const, error: v.error };
      const email = normalizeEmail(data.email);
      if (email === normalizeEmail(who.email))
        return { ok: false as const, error: "You are already in this workspace." };
      const { getDoc, commit } = await import("@/lib/firebase/admin.server");
      const ip = await invitePath(email);
      const prior = await getDoc(ip);
      if (prior && prior["status"] === "accepted")
        return {
          ok: false as const,
          error: "That email already belongs to a RETAIN.AI workspace.",
        };
      if (prior && prior["status"] === "pending" && prior["merchantId"] !== merchantId)
        return {
          ok: false as const,
          error: "That email already has a pending invitation from another workspace.",
        };
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 86400_000).toISOString();
      const team = await readTeam(merchantId);
      const key = ip.split("/")[1] as string;
      team[key] = {
        email,
        role: data.role,
        status: "pending",
        invitedAt: now.toISOString(),
        expiresAt,
      };
      await commit([
        {
          op: "set",
          path: ip,
          data: {
            email,
            merchantId,
            role: data.role,
            status: "pending",
            invitedBy: who.uid,
            createdAt: now.toISOString(),
            expiresAt,
          },
        },
        {
          op: "set",
          path: teamPath(merchantId),
          data: { invites: team, updatedAt: now.toISOString() },
        },
      ]);
      return { ok: true as const };
    } catch (e) {
      return fail(e);
    }
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ idToken: token, inviteId: z.string().regex(/^[a-f0-9]{64}$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const who = await verifyFirebaseIdentity(data.idToken);
      const { merchantId, role } = await (await srv()).resolveMerchant(who.uid);
      const v = canManageTeam(role);
      if (!v.ok) return { ok: false as const, error: v.error };
      const { getDoc, commit } = await import("@/lib/firebase/admin.server");
      const ip = `merchantInvites/${data.inviteId}`;
      const inv = await getDoc(ip);
      if (!inv || inv["merchantId"] !== merchantId || inv["status"] !== "pending")
        return { ok: false as const, error: "That invitation can no longer be revoked." };
      const team = await readTeam(merchantId);
      if (team[data.inviteId]) team[data.inviteId] = { ...team[data.inviteId]!, status: "revoked" };
      const now = new Date().toISOString();
      await commit([
        { op: "merge", path: ip, data: { status: "revoked", revokedAt: now } },
        { op: "set", path: teamPath(merchantId), data: { invites: team, updatedAt: now } },
      ]);
      return { ok: true as const };
    } catch (e) {
      return fail(e);
    }
  });
