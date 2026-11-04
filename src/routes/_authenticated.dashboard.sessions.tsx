import { DevpilotJourneyPanel } from "@/components/dashboard/devpilot-journey";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useWorkspace } from "@/lib/dashboard/workspace";
import { useTable } from "@/lib/dashboard/use-table";
import { inRange, money, type RetentionSession } from "@/lib/dashboard/model";
import {
  DataGate,
  DemoBadge,
  PageHeader,
  RangeSelect,
  StatusPill,
  dateFmt,
  label,
  sessionTone,
} from "@/components/dashboard/ui";
import { DataTable, type Column } from "@/components/dashboard/tables";

export const Route = createFileRoute("/_authenticated/dashboard/sessions")({
  head: () => ({
    meta: [
      { title: "Retention Sessions · RETAIN.AI" },
      {
        name: "description",
        content:
          "Live and past retention conversations between your AI agent and cancelling customers.",
      },
      { property: "og:title", content: "Retention Sessions · RETAIN.AI" },
      { property: "og:description", content: "Every retention conversation." },
    ],
  }),
  component: Sessions,
});

const columns: Column<RetentionSession>[] = [
  {
    key: "customer",
    header: "Customer",
    cell: (s) => <span className="font-medium">{s.customerName}</span>,
  },
  {
    key: "reason",
    header: "Reason",
    className: "hidden md:table-cell",
    cell: (s) => <span className="text-muted-foreground">{s.reason}</span>,
  },
  { key: "offer", header: "Offer", cell: (s) => s.offer },
  {
    key: "status",
    header: "Outcome",
    cell: (s) => <StatusPill tone={sessionTone[s.status]}>{label(s.status)}</StatusPill>,
  },
  {
    key: "value",
    header: "Est. value",
    className: "text-right tabular-nums",
    cell: (s) => money(s.estimatedValue),
  },
  {
    key: "date",
    header: "Started",
    className: "hidden lg:table-cell",
    cell: (s) => dateFmt(s.startedAt),
  },
];

function Sessions() {
  const { data, demo, range, now } = useWorkspace();
  const rows = useMemo(
    () => data.sessions.filter((s) => s.status === "active" || inRange(s.startedAt, range, now)),
    [data.sessions, range, now],
  );
  const table = useTable(rows, {
    text: (s) => `${s.customerName} ${s.reason} ${s.offer}`,
    status: (s) => s.status,
  });
  return (
    <>
      <PageHeader
        title="Retention Sessions"
        description="Conversations update live as customers interact with your agent."
        actions={
          <>
            {demo && <DemoBadge />}
            <RangeSelect />
          </>
        }
      />
      <DevpilotJourneyPanel focus="session" />
      <DataGate
        hasRows={data.sessions.length > 0}
        emptyTitle="No retention sessions yet"
        emptyDescription="Sessions stream in live when a customer opens your cancellation portal."
      >
        <DataTable
          table={table}
          columns={columns}
          search="Search sessions"
          statuses={["active", "retained", "cancelled", "escalated"].map((v) => ({
            value: v,
            label: label(v),
          }))}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Estimated value is a projection of retained revenue. It is not a PayPal-verified payment.
        </p>
      </DataGate>
    </>
  );
}
