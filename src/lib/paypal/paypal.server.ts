import { DEVPILOT, type SubscriptionSnapshot } from "./journey";

const BASE = "https://api-m.sandbox.paypal.com"; // Sandbox only, by design.

export class PaypalError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
  }
}

export async function paypalToken() {
  const id = process.env["PAYPAL_CLIENT_ID"];
  const secret = process.env["PAYPAL_CLIENT_SECRET"];
  if (!id || !secret)
    throw new PaypalError("PayPal Sandbox credentials are not configured.", 0, "");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const b = await res.text();
    console.error(`PayPal token [${res.status}]: ${b}`);
    throw new PaypalError("PayPal rejected the Sandbox credentials.", res.status, b);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

async function call<T>(
  method: string,
  path: string,
  opts: { body?: unknown; requestId?: string } = {},
): Promise<{ status: number; data: T | null }> {
  const token = await paypalToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId; // PayPal-side idempotency
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`PayPal ${method} ${path} [${res.status}]: ${text}`);
    throw new PaypalError(`PayPal request failed (${res.status}).`, res.status, text);
  }
  return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
}

interface RawSub {
  id: string;
  status: string;
  plan_id: string;
  custom_id?: string;
  status_update_time?: string;
  start_time?: string;
  billing_info?: {
    next_billing_time?: string;
    last_payment?: { amount?: { value: string; currency_code: string }; time?: string };
  };
  links?: { href: string; rel: string }[];
}

export const isSubscriptionId = (id: string) => /^I-[A-Z0-9]{12}$/.test(id);

export async function findDevpilotPlan() {
  const configured = process.env["PAYPAL_PLAN_ID"];
  if (configured && /^P-[A-Z0-9]+$/.test(configured)) return configured;
  const { data } = await call<{ plans?: { id: string; name: string; status: string }[] }>(
    "GET",
    "/v1/billing/plans?page_size=20",
  );
  const plan = data?.plans?.find(
    (p) => p.name === DEVPILOT.planDisplayName && p.status === "ACTIVE",
  );
  if (!plan)
    throw new PaypalError(
      `No active “${DEVPILOT.planDisplayName}” plan found in PayPal Sandbox.`,
      404,
      "",
    );
  return plan.id;
}

export async function getPlanPrice(planId: string) {
  const { data } = await call<{
    billing_cycles?: {
      tenure_type: string;
      pricing_scheme: { fixed_price: { value: string; currency_code: string } };
    }[];
  }>("GET", `/v1/billing/plans/${planId}`);
  const p = data?.billing_cycles?.find((c) => c.tenure_type === "REGULAR")?.pricing_scheme
    .fixed_price;
  return p ? { amount: Number(p.value), currency: p.currency_code } : null;
}

export async function getSubscription(
  id: string,
): Promise<(SubscriptionSnapshot & { raw: RawSub }) | null> {
  if (!isSubscriptionId(id)) return null;
  try {
    const { data } = await call<RawSub>("GET", `/v1/billing/subscriptions/${id}`);
    if (!data) return null;
    return {
      id: data.id,
      status: data.status,
      planId: data.plan_id,
      customId: data.custom_id ?? null,
      raw: data,
    };
  } catch (e) {
    if (e instanceof PaypalError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

export async function createSubscription(
  planId: string,
  uid: string,
  returnUrl: string,
  cancelUrl: string,
  requestId: string,
) {
  const { data } = await call<RawSub>("POST", "/v1/billing/subscriptions", {
    requestId,
    body: {
      plan_id: planId,
      custom_id: uid,
      application_context: {
        brand_name: "DevPilot AI (demo)",
        user_action: "SUBSCRIBE_NOW",
        shipping_preference: "NO_SHIPPING",
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    },
  });
  const approve = data?.links?.find((l) => l.rel === "approve")?.href;
  if (!data || !approve) throw new PaypalError("PayPal did not return an approval link.", 502, "");
  return { id: data.id, approveUrl: approve };
}

export async function runOperation(
  id: string,
  op: "suspend" | "cancel",
  reason: string,
  requestId: string,
) {
  await call("POST", `/v1/billing/subscriptions/${id}/${op}`, {
    requestId,
    body: { reason: reason.slice(0, 120) },
  });
}
