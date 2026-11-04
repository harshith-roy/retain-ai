/**
 * Server-only guards: verified identity + linked workspace, and per-user /
 * per-workspace usage limits stored in a Firestore collection the Rules
 * never expose. Bucket keys come from the verified token, not the request.
 */
import { verifyFirebaseIdentity } from "@/lib/retention/providers.server";
import { overLimit, rateBuckets, type RateAction } from "./access";

export async function requireWorkspace(idToken: string) {
  const who = await verifyFirebaseIdentity(idToken);
  const { resolveMerchant } = await import("@/lib/records/records.server");
  const { merchantId, role } = await resolveMerchant(who.uid);
  return { who, merchantId, role };
}

export class RateLimitError extends Error {}

export async function enforceRateLimit(
  action: RateAction,
  uid: string,
  merchantId: string,
  now = new Date(),
) {
  const buckets = rateBuckets(action, uid, merchantId, now);
  const { increment } = await import("@/lib/firebase/admin.server");
  const counts = await increment(
    buckets.map((b) => `rateLimits/${b.key}`),
    "count",
    { action, updatedAt: now.toISOString() },
  );
  if (overLimit(buckets.map((b, i) => ({ max: b.max, count: counts[i] ?? Infinity })))) {
    throw new RateLimitError("Usage limit reached for this hour. Please try again later.");
  }
}

/** Workspace check + rate limit in one call for AI and voice endpoints. */
export async function guardUsage(idToken: string, action: RateAction) {
  const ctx = await requireWorkspace(idToken);
  await enforceRateLimit(action, ctx.who.uid, ctx.merchantId);
  return ctx;
}
