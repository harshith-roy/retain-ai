import { DevpilotJourneyPanel } from "@/components/dashboard/devpilot-journey";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ArrowRight, CircleDollarSign, Clock, ShieldCheck, Target, TrendingUp, UserCheck } from "lucide-react";
import { useWorkspace } from "@/lib/dashboard/workspace";
import { computeMetrics, dailySeries, funnel, inRange, money, pct, statusDistribution } from "@/lib/dashboard/model";
import { DataGate, DemoBadge, PageHeader, Panel, RangeSelect, StatusPill, label, sessionTone, timeAgo } from "@/components/dashboard/ui";
import { useFirebaseAuth } from "@/hooks/use-firebase-auth";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  head: () => ({ meta: [
    { title: "Overview · RETAIN.AI" },
    { name: "description", content: "Retention performance, cancellation funnel and pending approvals for your workspace." },
    { property: "og:title", content: "Overview · RETAIN.AI" },
    { property: "og:description", content: "Retention performance at a glance." },
  ] }),
  component: Overview,
});

const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" };
const PIE = ["var(--chart-3)", "var(--chart-2)", "var(--chart-1)", "var(--chart-4)", "var(--muted-foreground)"];

function Overview() {
  const auth = useFirebaseAuth();
  const { data, range, now, demo } = useWorkspace();
  const m = computeMetrics(data, range, now);
  const series = dailySeries(data, range, now);
  const steps = funnel(data, range, now);
  const dist = statusDistribution(data).filter((d) => d.count > 0);
  const recent = data.sessions.filter((s) => inRange(s.startedAt, range, now)).slice(0, 6);
  const pending = data.approvals.filter((a) => a.status === "pending").slice(0, 4);
  const kpis = [
    { label: "Cancellation attempts", value: m.attempts.toLocaleString(), icon: Activity },
    { label: "Customers retained", value: m.retained.toLocaleString(), icon: UserCheck },
    { label: "Retention conversion", value: pct(m.conversion), icon: Target },
    { label: "Estimated revenue recovered", value: money(m.estimatedRecovered), icon: CircleDollarSign, note: "Estimate · not PayPal-verified" },
    { label: "Active sessions", value: m.active.toLocaleString(), icon: TrendingUp, live: m.active > 0 },
    { label: "Pending approvals", value: m.pendingApprovals.toLocaleString(), icon: Clock },
  ];
  return <>
    <PageHeader title={`Good to see you, ${auth.user?.displayName?.split(" ")[0] ?? "there"}`} description="How your retention agent is performing." actions={<>{demo && <DemoBadge />}<RangeSelect /></>} />
    <DevpilotJourneyPanel focus="all" />
    <DataGate emptyTitle="No retention activity yet" emptyDescription="When customers start cancelling through your portal, attempts, saves and approvals appear here in real time.">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => <div key={k.label} className="animate-rise bg-surface p-4 transition-colors hover:bg-accent/40">
          <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{k.label}</span><k.icon className="size-3.5" /></div>
          <div className="mt-3 flex items-center gap-2 text-2xl font-semibold tabular-nums">{k.value}{k.live && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan opacity-60" /><span className="relative size-2 rounded-full bg-cyan" /></span>}</div>
          {k.note && <p className="mt-1 text-[11px] text-muted-foreground">{k.note}</p>}
        </div>)}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Retention performance" description="Daily cancellation attempts vs. customers retained">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ left: -20, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--border)" }} />
                <Area type="monotone" dataKey="attempts" name="Attempts" stroke="var(--chart-1)" fill="url(#gA)" strokeWidth={2} />
                <Area type="monotone" dataKey="retained" name="Retained" stroke="var(--chart-2)" fill="url(#gR)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex gap-4 text-xs text-muted-foreground"><Legend color="bg-violet" label="Attempts" /><Legend color="bg-cyan" label="Retained" /></div>
        </Panel>
        <Panel title="Cancellation funnel" description="From intent to save">
          <div className="space-y-4">{steps.map((s) => { const top = steps[0]?.value ?? 0; const w = top ? (s.value / top) * 100 : 0; return <div key={s.stage}>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">{s.stage}</span><span className="tabular-nums">{s.value} <span className="text-muted-foreground">· {Math.round(w)}%</span></span></div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${w}%` }} /></div>
          </div>; })}</div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Recent activity" action={<Link to="/dashboard/sessions" className="text-xs text-muted-foreground hover:text-foreground">View all</Link>}>
          {recent.length ? <ul className="-my-2 divide-y">{recent.map((s) => <li key={s.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm">{s.customerName}</p><p className="truncate text-xs text-muted-foreground">{s.reason} · {timeAgo(s.startedAt, now)}</p></div><StatusPill tone={sessionTone[s.status]}>{label(s.status)}</StatusPill></li>)}</ul> : <p className="text-sm text-muted-foreground">No sessions in this range.</p>}
        </Panel>
        <Panel title="Pending approvals" action={<Link to="/dashboard/escalations" className="text-xs text-muted-foreground hover:text-foreground">Escalation center</Link>}>
          {pending.length ? <ul className="-my-2 divide-y">{pending.map((a) => <li key={a.id} className="py-2.5"><div className="flex justify-between gap-2 text-sm"><span className="truncate">{a.customerName}</span>{a.amount > 0 && <span className="tabular-nums text-muted-foreground">{money(a.amount)}</span>}</div><p className="text-xs text-muted-foreground">{a.type}</p></li>)}</ul> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="size-4" />Nothing waiting for you.</p>}
        </Panel>
        <Panel title="Subscription status">
          {dist.length ? <div className="flex items-center gap-4">
            <div className="size-32 shrink-0"><ResponsiveContainer><PieChart><Pie data={dist} dataKey="count" nameKey="status" innerRadius={38} outerRadius={60} stroke="var(--surface)" strokeWidth={2}>{dist.map((d, i) => <Cell key={d.status} fill={PIE[i % PIE.length]} />)}</Pie><Tooltip contentStyle={tooltipStyle} /></PieChart></ResponsiveContainer></div>
            <ul className="flex-1 space-y-1.5 text-xs">{dist.map((d, i) => <li key={d.status} className="flex items-center justify-between"><span className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-sm" style={{ background: PIE[i % PIE.length] }} />{label(d.status)}</span><span className="tabular-nums">{d.count}</span></li>)}</ul>
          </div> : <p className="text-sm text-muted-foreground">No subscriptions synced yet.</p>}
        </Panel>
      </div>
      <Link to="/dashboard/analytics" className="mt-4 flex items-center justify-between rounded-xl border bg-surface px-5 py-4 text-sm transition-colors hover:bg-accent/40"><span><span className="font-medium">Verified PayPal outcomes</span> <span className="text-muted-foreground">— confirmed pause and cancellation results are in the DevPilot journey. Revenue figures above are estimates.</span></span><ArrowRight className="size-4 text-muted-foreground" /></Link>
    </DataGate>
  </>;
}

function Legend({ color, label }: { color: string; label: string }) { return <span className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${color}`} />{label}</span>; }
