// Pure dashboard model: normalises Firestore documents, generates clearly
// labelled demonstration data, and computes metrics. No browser or Firebase
// side effects live here so the rules can be unit tested.

export type RangeKey = "7d" | "30d" | "90d";
export const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
];

export type SessionStatus = "active" | "retained" | "cancelled" | "escalated";
export type SubscriptionStatus = "active" | "paused" | "past_due" | "cancelled" | "trialing";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Customer {
  id: string;
  name: string;
  email: string;
  plan: string;
  status: "active" | "at_risk" | "churned";
  mrr: number;
  createdAt: Date;
}
export interface Subscription {
  id: string;
  customerName: string;
  plan: string;
  amount: number;
  interval: "month" | "year";
  status: SubscriptionStatus;
  startedAt: Date;
}
export interface RetentionSession {
  id: string;
  customerName: string;
  reason: string;
  offer: string;
  status: SessionStatus;
  estimatedValue: number;
  startedAt: Date;
}
export interface Approval {
  id: string;
  customerName: string;
  type: string;
  amount: number;
  reason: string;
  status: ApprovalStatus;
  createdAt: Date;
}

export interface Dataset {
  customers: Customer[];
  subscriptions: Subscription[];
  sessions: RetentionSession[];
  approvals: Approval[];
}

type RawKey =
  | "name"
  | "email"
  | "plan"
  | "status"
  | "mrr"
  | "createdAt"
  | "customerName"
  | "amount"
  | "interval"
  | "startedAt"
  | "reason"
  | "offer"
  | "estimatedValue"
  | "type";
type Raw = Partial<Record<RawKey, unknown>>;
function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  )
    return (value as { toDate: () => Date }).toDate();
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(0);
}
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

export const normalise = {
  customer: (id: string, d: Raw): Customer => ({
    id,
    name: str(d.name, "Unnamed customer"),
    email: str(d.email),
    plan: str(d.plan, "—"),
    status: pick(d.status, ["active", "at_risk", "churned"] as const, "active"),
    mrr: num(d.mrr),
    createdAt: toDate(d.createdAt),
  }),
  subscription: (id: string, d: Raw): Subscription => ({
    id,
    customerName: str(d.customerName, "Unknown"),
    plan: str(d.plan, "—"),
    amount: num(d.amount),
    interval: pick(d.interval, ["month", "year"] as const, "month"),
    status: pick(
      d.status,
      ["active", "paused", "past_due", "cancelled", "trialing"] as const,
      "active",
    ),
    startedAt: toDate(d.startedAt),
  }),
  session: (id: string, d: Raw): RetentionSession => ({
    id,
    customerName: str(d.customerName, "Unknown"),
    reason: str(d.reason, "Not given"),
    offer: str(d.offer, "—"),
    status: pick(d.status, ["active", "retained", "cancelled", "escalated"] as const, "active"),
    estimatedValue: num(d.estimatedValue),
    startedAt: toDate(d.startedAt),
  }),
  approval: (id: string, d: Raw): Approval => ({
    id,
    customerName: str(d.customerName, "Unknown"),
    type: str(d.type, "Offer"),
    amount: num(d.amount),
    reason: str(d.reason),
    status: pick(d.status, ["pending", "approved", "rejected"] as const, "pending"),
    createdAt: toDate(d.createdAt),
  }),
};

export function rangeStart(range: RangeKey, now: Date) {
  const days = RANGES.find((r) => r.key === range)?.days ?? 30;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}
export const inRange = (date: Date, range: RangeKey, now: Date) =>
  date >= rangeStart(range, now) && date <= now;

export interface Metrics {
  attempts: number;
  retained: number;
  conversion: number | null;
  estimatedRecovered: number;
  active: number;
  pendingApprovals: number;
}
export function computeMetrics(data: Dataset, range: RangeKey, now: Date): Metrics {
  const sessions = data.sessions.filter((s) => inRange(s.startedAt, range, now));
  const retained = sessions.filter((s) => s.status === "retained");
  const decided = sessions.filter(
    (s) => s.status === "retained" || s.status === "cancelled",
  ).length;
  return {
    attempts: sessions.length,
    retained: retained.length,
    conversion: decided ? retained.length / decided : null,
    // Estimated only: derived from the session's projected value, never from PayPal.
    estimatedRecovered: retained.reduce((sum, s) => sum + s.estimatedValue, 0),
    active: data.sessions.filter((s) => s.status === "active").length,
    pendingApprovals: data.approvals.filter((a) => a.status === "pending").length,
  };
}

const localKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function dailySeries(data: Dataset, range: RangeKey, now: Date) {
  const days: { date: string; attempts: number; retained: number }[] = [];
  for (const d = rangeStart(range, now); d <= now; d.setDate(d.getDate() + 1))
    days.push({ date: localKey(d), attempts: 0, retained: 0 });
  const index = new Map(days.map((d, i) => [d.date, i]));
  for (const s of data.sessions) {
    if (!inRange(s.startedAt, range, now)) continue;
    const i = index.get(localKey(s.startedAt));
    if (i === undefined) continue;
    const day = days[i]!;
    day.attempts++;
    if (s.status === "retained") day.retained++;
  }
  return days;
}

export function funnel(data: Dataset, range: RangeKey, now: Date) {
  const s = data.sessions.filter((x) => inRange(x.startedAt, range, now));
  const offered = s.filter((x) => x.offer && x.offer !== "—").length;
  return [
    { stage: "Cancellation attempts", value: s.length },
    { stage: "Offer presented", value: offered },
    { stage: "Engaged / escalated", value: s.filter((x) => x.status !== "cancelled").length },
    { stage: "Retained", value: s.filter((x) => x.status === "retained").length },
  ];
}

export function statusDistribution(data: Dataset) {
  const counts: Record<SubscriptionStatus, number> = {
    active: 0,
    trialing: 0,
    paused: 0,
    past_due: 0,
    cancelled: 0,
  };
  for (const s of data.subscriptions) counts[s.status]++;
  return (Object.keys(counts) as SubscriptionStatus[]).map((status) => ({
    status,
    count: counts[status],
  }));
}

export const isEmpty = (d: Dataset) =>
  !d.customers.length && !d.subscriptions.length && !d.sessions.length && !d.approvals.length;

// ---- Demonstration data (always rendered with a visible "Demo data" label) ----
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const NAMES = [
  "Ava Thompson",
  "Liam Patel",
  "Mia Chen",
  "Noah García",
  "Zara Okafor",
  "Ethan Novak",
  "Isla Romero",
  "Kai Nakamura",
  "Leah Fischer",
  "Omar Haddad",
  "Priya Raman",
  "Lucas Moreau",
  "Sofia Rossi",
  "Jonah Weiss",
  "Amara Diallo",
  "Felix Andersson",
  "Hana Kim",
  "Mateo Silva",
  "Nora Lindqvist",
  "Ravi Mehta",
];
const PLANS = [
  { name: "Starter", price: 19 },
  { name: "Growth", price: 49 },
  { name: "Scale", price: 129 },
];
const REASONS = [
  "Too expensive",
  "Not using it enough",
  "Missing a feature",
  "Switching to competitor",
  "Temporary pause",
  "Technical issues",
];
const OFFERS = [
  "20% off for 3 months",
  "Pause for 1 month",
  "Downgrade to Starter",
  "Free month",
  "—",
];

export function makeDemoData(now: Date): Dataset {
  const rand = prng(2026);
  const at = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * 86_400_000 - Math.floor(rand() * 20) * 3_600_000);
  const customers: Customer[] = NAMES.map((name, i) => {
    const plan = PLANS[i % 3]!;
    return {
      id: `demo-c${i}`,
      name,
      email: `${name.split(" ")[0]!.toLowerCase()}@example.com`,
      plan: plan.name,
      status: i % 7 === 0 ? "churned" : i % 4 === 0 ? "at_risk" : "active",
      mrr: plan.price,
      createdAt: at(30 + i * 9),
    };
  });
  const subStatus: SubscriptionStatus[] = [
    "active",
    "active",
    "active",
    "trialing",
    "paused",
    "past_due",
    "active",
    "cancelled",
  ];
  const subscriptions: Subscription[] = customers.map((c, i) => ({
    id: `demo-s${i}`,
    customerName: c.name,
    plan: c.plan,
    amount: c.mrr,
    interval: i % 5 === 0 ? "year" : "month",
    status: c.status === "churned" ? "cancelled" : (subStatus[i % subStatus.length] ?? "active"),
    startedAt: c.createdAt,
  }));
  const sessions: RetentionSession[] = Array.from({ length: 64 }, (_, i) => {
    const c = customers[Math.floor(rand() * customers.length)]!;
    const r = rand();
    const status: SessionStatus =
      i < 3 ? "active" : r < 0.46 ? "retained" : r < 0.82 ? "cancelled" : "escalated";
    const offer = OFFERS[Math.floor(rand() * OFFERS.length)]!;
    return {
      id: `demo-r${i}`,
      customerName: c.name,
      reason: REASONS[Math.floor(rand() * REASONS.length)]!,
      offer,
      status,
      estimatedValue: c.mrr * 3,
      startedAt: i < 3 ? new Date(now.getTime() - i * 600_000) : at(Math.floor(rand() * 88)),
    };
  }).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const approvals: Approval[] = [
    {
      id: "demo-a1",
      customerName: "Omar Haddad",
      type: "Discount above limit",
      amount: 45,
      reason: "Requested 40% off — limit is 25%",
      status: "pending",
      createdAt: at(0),
    },
    {
      id: "demo-a2",
      customerName: "Priya Raman",
      type: "Extended pause",
      amount: 0,
      reason: "3-month pause requested",
      status: "pending",
      createdAt: at(1),
    },
    {
      id: "demo-a3",
      customerName: "Lucas Moreau",
      type: "Refund request",
      amount: 129,
      reason: "Billing dispute escalated by agent",
      status: "pending",
      createdAt: at(2),
    },
    {
      id: "demo-a4",
      customerName: "Hana Kim",
      type: "Free month",
      amount: 49,
      reason: "Long-time customer",
      status: "approved",
      createdAt: at(5),
    },
  ];
  return { customers, subscriptions, sessions, approvals };
}

export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
export const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 1000) / 10}%`);
