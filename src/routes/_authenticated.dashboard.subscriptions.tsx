import { DevpilotJourneyPanel } from "@/components/dashboard/devpilot-journey";
import { createFileRoute } from "@tanstack/react-router";
import { useWorkspace } from "@/lib/dashboard/workspace";
import { useTable } from "@/lib/dashboard/use-table";
import { money, type Subscription } from "@/lib/dashboard/model";
import {
  DataGate,
  DemoBadge,
  PageHeader,
  StatusPill,
  dateFmt,
  label,
  subscriptionTone,
} from "@/components/dashboard/ui";
import { DataTable, type Column } from "@/components/dashboard/tables";

export const Route = createFileRoute("/_authenticated/dashboard/subscriptions")({
  head: () => ({
    meta: [
      { title: "Subscriptions · RETAIN.AI" },
      {
        name: "description",
        content: "Subscription plans, billing intervals and statuses across your customers.",
      },
      { property: "og:title", content: "Subscriptions · RETAIN.AI" },
      { property: "og:description", content: "Your workspace subscriptions." },
    ],
  }),
  component: Subscriptions,
});

const columns: Column<Subscription>[] = [
  {
    key: "customer",
    header: "Customer",
    cell: (s) => <span className="font-medium">{s.customerName}</span>,
  },
  { key: "plan", header: "Plan", cell: (s) => s.plan },
  {
    key: "amount",
    header: "Amount",
    className: "tabular-nums",
    cell: (s) => `${money(s.amount)} / ${s.interval === "year" ? "yr" : "mo"}`,
  },
  {
    key: "status",
    header: "Status",
    cell: (s) => <StatusPill tone={subscriptionTone[s.status]}>{label(s.status)}</StatusPill>,
  },
  {
    key: "started",
    header: "Started",
    className: "hidden md:table-cell",
    cell: (s) => dateFmt(s.startedAt),
  },
];

function Subscriptions() {
  const { data, demo } = useWorkspace();
  const table = useTable(data.subscriptions, {
    text: (s) => `${s.customerName} ${s.plan}`,
    status: (s) => s.status,
  });
  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Plans and billing status for every customer."
        actions={demo && <DemoBadge />}
      />
      <DevpilotJourneyPanel focus="subscription" />
      <DataGate
        hasRows={data.subscriptions.length > 0}
        emptyTitle="No subscriptions synced"
        emptyDescription="Subscriptions appear once PayPal Sandbox billing is connected in a later phase."
      >
        <DataTable
          table={table}
          columns={columns}
          search="Search subscriptions"
          statuses={["active", "trialing", "paused", "past_due", "cancelled"].map((v) => ({
            value: v,
            label: label(v),
          }))}
        />
      </DataGate>
    </>
  );
}
