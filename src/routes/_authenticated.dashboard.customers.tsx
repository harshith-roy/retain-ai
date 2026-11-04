import { DevpilotJourneyPanel } from "@/components/dashboard/devpilot-journey";
import { createFileRoute } from "@tanstack/react-router";
import { useWorkspace } from "@/lib/dashboard/workspace";
import { useTable } from "@/lib/dashboard/use-table";
import { money, type Customer } from "@/lib/dashboard/model";
import {
  DataGate,
  DemoBadge,
  PageHeader,
  StatusPill,
  dateFmt,
  label,
} from "@/components/dashboard/ui";
import { DataTable, type Column } from "@/components/dashboard/tables";

export const Route = createFileRoute("/_authenticated/dashboard/customers")({
  head: () => ({
    meta: [
      { title: "Customers · RETAIN.AI" },
      {
        name: "description",
        content: "Search and filter the customers in your RETAIN.AI workspace.",
      },
      { property: "og:title", content: "Customers · RETAIN.AI" },
      { property: "og:description", content: "Your workspace customers." },
    ],
  }),
  component: Customers,
});

const tone = { active: "success", at_risk: "warning", churned: "muted" } as const;
const columns: Column<Customer>[] = [
  {
    key: "name",
    header: "Customer",
    cell: (c) => (
      <div>
        <p className="font-medium">{c.name}</p>
        <p className="text-xs text-muted-foreground">{c.email}</p>
      </div>
    ),
  },
  { key: "plan", header: "Plan", cell: (c) => c.plan },
  {
    key: "status",
    header: "Status",
    cell: (c) => <StatusPill tone={tone[c.status]}>{label(c.status)}</StatusPill>,
  },
  { key: "mrr", header: "MRR", className: "text-right tabular-nums", cell: (c) => money(c.mrr) },
  {
    key: "since",
    header: "Customer since",
    className: "hidden md:table-cell",
    cell: (c) => dateFmt(c.createdAt),
  },
];

function Customers() {
  const { data, demo } = useWorkspace();
  const table = useTable(data.customers, {
    text: (c) => `${c.name} ${c.email} ${c.plan}`,
    status: (c) => c.status,
  });
  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone subscribed to your products."
        actions={demo && <DemoBadge />}
      />
      <DevpilotJourneyPanel focus="session" />
      <DataGate
        hasRows={data.customers.length > 0}
        emptyTitle="No customers synced"
        emptyDescription="Customers appear here once your billing data is synced by the RETAIN.AI backend."
      >
        <DataTable
          table={table}
          columns={columns}
          search="Search customers"
          statuses={[
            { value: "active", label: "Active" },
            { value: "at_risk", label: "At risk" },
            { value: "churned", label: "Churned" },
          ]}
        />
      </DataGate>
    </>
  );
}
