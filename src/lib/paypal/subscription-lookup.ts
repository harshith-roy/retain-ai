/**
 * Ownership-bound PayPal subscription lookup. Pure (dependencies injected) so
 * it can be tested without PayPal or Firebase. Subscriptions that are missing
 * or belong to someone else get the same generic answer, so the caller cannot
 * learn anything about another user's subscription.
 */
export const NOT_FOUND = "Subscription not found.";
export const SIGN_IN_REQUIRED = "Please sign in again to view this subscription.";
export const INVALID_ID = "That is not a PayPal subscription ID (they start with I-).";

export interface RawSub {
  id: string;
  status: string;
  planId: string;
  customId: string | null;
  raw: {
    billing_info?: {
      next_billing_time?: string | null;
      last_payment?: {
        amount?: {
          value: string;
          currency_code: string;
        };
        time?: string | null;
      };
      cycle_executions?:
        { sequence: number; cycle_stage: string; cycles_completed: number }[] | null;
    };
    plan_overridden?: boolean | null;
    plan?: {
      billing_cycles?:
        | {
            sequence: number;
            tenure_type?: string;
            pricing_scheme?: { fixed_price?: { value: string; currency_code: string } };
          }[]
        | null;
    } | null;
    status_update_time?: string | null;
    start_time?: string | null;
  };
}
export interface LookupDeps {
  verifyUser: (idToken: string) => Promise<string>;
  isSubscriptionId: (id: string) => boolean;
  getSubscription: (id: string) => Promise<RawSub | null>;
  getPlanPrice: (planId: string) => Promise<{ amount: number; currency: string } | null>;
}
export interface SubscriptionDTO {
  id: string;
  status: string;
  planId: string;
  ownedByYou: boolean;
  amount: number | null;
  currency: string | null;
  nextBillingTime: string | null;
  lastPayment: { amount: string; currency: string; time: string | null } | null;
  statusUpdateTime: string | null;
  startTime: string | null;
  source: "paypal_sandbox";
}
export type LookupResult =
  { ok: true; subscription: SubscriptionDTO } | { ok: false; error: string };

/** When PayPal exposes an overridden plan, report the cycle currently in effect. */
export function currentCyclePrice(raw: RawSub["raw"]): { amount: number; currency: string } | null {
  const cycles = raw?.plan_overridden ? raw.plan?.billing_cycles : null;
  if (!cycles?.length) return null;
  const currentSeq = raw.billing_info?.cycle_executions?.find(
    (e) => e.cycle_stage === "CURRENT",
  )?.sequence;
  const cycle =
    (currentSeq != null ? cycles.find((c) => c.sequence === currentSeq) : undefined) ?? cycles[0];
  const fixed = cycle?.pricing_scheme?.fixed_price;
  if (!fixed) return null;
  const amount = Number(fixed.value);
  return Number.isFinite(amount) ? { amount, currency: fixed.currency_code } : null;
}

export async function lookupOwnedSubscription(
  deps: LookupDeps,
  idToken: string,
  subscriptionId: string,
): Promise<LookupResult> {
  let uid: string;
  try {
    uid = await deps.verifyUser(idToken);
  } catch {
    return { ok: false, error: SIGN_IN_REQUIRED };
  }
  if (!uid) return { ok: false, error: SIGN_IN_REQUIRED };
  if (!deps.isSubscriptionId(subscriptionId)) return { ok: false, error: INVALID_ID };
  const s = await deps.getSubscription(subscriptionId);
  if (!s || !s.customId || s.customId !== uid) return { ok: false, error: NOT_FOUND };
  const planPrice = await deps.getPlanPrice(s.planId).catch(() => null);
  const price = currentCyclePrice(s.raw) ?? planPrice;
  const lp = s.raw?.billing_info?.last_payment;
  return {
    ok: true,
    subscription: {
      id: s.id,
      status: s.status,
      planId: s.planId,
      ownedByYou: true,
      amount: price?.amount ?? null,
      currency: price?.currency ?? null,
      nextBillingTime: s.raw?.billing_info?.next_billing_time ?? null,
      lastPayment: lp?.amount
        ? { amount: lp.amount.value, currency: lp.amount.currency_code, time: lp.time ?? null }
        : null,
      statusUpdateTime: s.raw?.status_update_time ?? null,
      startTime: s.raw?.start_time ?? null,
      source: "paypal_sandbox",
    },
  };
}
