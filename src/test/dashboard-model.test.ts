import { describe, expect, it } from "vitest";
import { computeMetrics, makeDemoData, rangeStart, type Dataset } from "@/lib/dashboard/model";
import { validateAgent, DEFAULT_AGENT } from "@/lib/dashboard/agent";

const now = new Date("2026-10-31T12:00:00");
const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
const base: Dataset = {
  customers: [],
  subscriptions: [],
  approvals: [],
  sessions: [
    {
      id: "1",
      customerName: "A",
      reason: "",
      offer: "x",
      status: "retained",
      estimatedValue: 100,
      startedAt: day(1),
    },
    {
      id: "2",
      customerName: "B",
      reason: "",
      offer: "x",
      status: "cancelled",
      estimatedValue: 50,
      startedAt: day(2),
    },
    {
      id: "3",
      customerName: "C",
      reason: "",
      offer: "x",
      status: "retained",
      estimatedValue: 70,
      startedAt: day(20),
    },
    {
      id: "4",
      customerName: "D",
      reason: "",
      offer: "x",
      status: "active",
      estimatedValue: 10,
      startedAt: day(0),
    },
  ],
};

describe("dashboard metrics", () => {
  it("counts only sessions inside the selected range", () => {
    expect(computeMetrics(base, "7d", now).attempts).toBe(3);
    expect(computeMetrics(base, "30d", now).attempts).toBe(4);
  });
  it("conversion is retained / decided sessions, ignoring active ones", () => {
    expect(computeMetrics(base, "7d", now).conversion).toBe(0.5);
  });
  it("estimated revenue sums only retained sessions", () => {
    expect(computeMetrics(base, "30d", now).estimatedRecovered).toBe(170);
  });
  it("no decided sessions means no conversion rate rather than 0%", () => {
    expect(computeMetrics({ ...base, sessions: [] }, "7d", now).conversion).toBeNull();
  });
  it("7-day range starts at midnight six days ago", () => {
    expect(rangeStart("7d", now).toDateString()).toBe(
      new Date("2026-10-25T00:00:00").toDateString(),
    );
  });
  it("demo data is deterministic and never contains payment transactions", () => {
    const a = makeDemoData(now),
      b = makeDemoData(now);
    expect(a.sessions.map((s) => s.status)).toEqual(b.sessions.map((s) => s.status));
    expect(Object.keys(a).sort()).toEqual(["approvals", "customers", "sessions", "subscriptions"]);
  });
});

describe("agent studio validation", () => {
  it("rejects discounts above 50%", () => {
    expect(validateAgent({ ...DEFAULT_AGENT, maxDiscount: 60 }).maxDiscount).toBeDefined();
  });
  it("rejects a website without https://", () => {
    expect(validateAgent({ ...DEFAULT_AGENT, website: "mystore" }).website).toBeDefined();
  });
  it("accepts the defaults", () => {
    expect(validateAgent(DEFAULT_AGENT)).toEqual({});
  });
});
