import { DevpilotJourneyPanel } from "@/components/dashboard/devpilot-journey";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BadgeCheck, CircleDollarSign } from "lucide-react";
import { useWorkspace } from "@/lib/dashboard/workspace";
import { computeMetrics, inRange, money, pct } from "@/lib/dashboard/model";
import { DataGate, DemoBadge, PageHeader, Panel, RangeSelect } from "@/components/dashboard/ui";

export const Route = createFileRoute("/_authenticated/dashboard/analytics")({
  head: () => ({
    meta: [
      { title: "Revenue Analytics · RETAIN.AI" },
      {
        name: "description",
        content: "Estimated recovered revenue kept separate from verified PayPal outcomes.",
      },
      { property: "og:title", content: "Revenue Analytics · RETAIN.AI" },
      { property: "og:description", content: "Estimated vs. verified revenue." },
    ],
  }),
  component: Analytics,
});

function Analytics() {
  const { data, demo, range, now } = useWorkspace();
  const m = computeMetrics(data, range, now);
  const byOffer = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of data.sessions)
      if (s.status === "retained" && inRange(s.startedAt, range, now))
        map.set(s.offer, (map.get(s.offer) ?? 0) + s.estimatedValue);
    return [...map]
      .map(([offer, value]) => ({ offer: offer === "—" ? "No offer" : offer, value }))
      .sort((a, b) => b.value - a.value);
  }, [data.sessions, range, now]);
  return (
    <>
      <PageHeader
        title="Revenue Analytics"
        description="Estimated revenue is always shown separately from verified PayPal outcomes."
        actions={
          <>
            {demo && <DemoBadge />}
            <RangeSelect />
          </>
        }
      />
      <DevpilotJourneyPanel focus="revenue" />
      <DataGate
        hasRows={data.sessions.length > 0}
        emptyTitle="No revenue data yet"
        emptyDescription="Estimates appear as soon as customers are retained."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Panel>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CircleDollarSign className="size-4 text-violet" />
              Estimated revenue recovered
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums">
              {money(m.estimatedRecovered)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Projection: 3 months of each retained customer’s plan · {m.retained} saves ·{" "}
              {pct(m.conversion)} conversion
            </p>
          </Panel>
          <Panel>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BadgeCheck className="size-4 text-cyan" />
              Verified PayPal outcomes
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-muted-foreground">—</p>
            <p className="mt-1 text-xs text-muted-foreground">
              PayPal Sandbox is connected. Confirmed pause and cancellation results appear in the
              DevPilot journey above; no revenue is counted as verified here.
            </p>
          </Panel>
        </div>
        <Panel
          className="mt-4"
          title="Estimated recovery by offer"
          description="Which retention offers save the most revenue"
        >
          {byOffer.length ? (
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={byOffer} layout="vertical" margin={{ left: 40, right: 16 }}>
                  <CartesianGrid stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    tickFormatter={(v: number) => money(v)}
                  />
                  <YAxis
                    type="category"
                    dataKey="offer"
                    width={130}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--accent)" }}
                    formatter={(v: number) => [money(v), "Estimated"]}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No retained customers in this range.</p>
          )}
        </Panel>
      </DataGate>
    </>
  );
}
