import { DevpilotJourneyPanel } from "@/components/dashboard/devpilot-journey";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Info, Loader2, X } from "lucide-react";
import { authStore } from "@/lib/firebase/auth";
import { decideApproval } from "@/lib/records/records.functions";
import { notifyJourneyChanged } from "@/lib/paypal/journey-store";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspace } from "@/lib/dashboard/workspace";
import { useTable } from "@/lib/dashboard/use-table";
import { money, type Approval } from "@/lib/dashboard/model";
import {
  DataGate,
  DemoBadge,
  PageHeader,
  StatusPill,
  label,
  timeAgo,
} from "@/components/dashboard/ui";
import { DataTable, type Column } from "@/components/dashboard/tables";

export const Route = createFileRoute("/_authenticated/dashboard/escalations")({
  head: () => ({
    meta: [
      { title: "Escalation Center · RETAIN.AI" },
      {
        name: "description",
        content: "Review offers and requests your AI agent escalated for human approval.",
      },
      { property: "og:title", content: "Escalation Center · RETAIN.AI" },
      { property: "og:description", content: "Human-in-the-loop approvals." },
    ],
  }),
  component: Escalations,
});

const tone = { pending: "warning", approved: "success", rejected: "muted" } as const;

function Escalations() {
  const { data, demo, now } = useWorkspace();
  const decide = useServerFn(decideApproval);
  const [busy, setBusy] = useState<string | null>(null);
  const uuidLike = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
  async function act(a: Approval, outcome: "approved" | "rejected") {
    if (busy) return;
    setBusy(a.id);
    try {
      const u = authStore.getSnapshot().user;
      if (!u) throw new Error("Please sign in again.");
      const r = await decide({
        data: { idToken: await u.getIdToken(), approvalId: a.id, outcome, note: "" },
      });
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(
          outcome === "approved"
            ? "Offer approved — the customer can now accept it"
            : "Offer rejected",
        );
        notifyJourneyChanged();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the decision.");
    } finally {
      setBusy(null);
    }
  }
  const table = useTable(data.approvals, {
    text: (a) => `${a.customerName} ${a.type} ${a.reason}`,
    status: (a) => a.status,
  });
  const columns: Column<Approval>[] = [
    {
      key: "customer",
      header: "Customer",
      cell: (a) => (
        <div>
          <p className="font-medium">{a.customerName}</p>
          <p className="text-xs text-muted-foreground">{timeAgo(a.createdAt, now)}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Request",
      cell: (a) => (
        <div>
          <p>{a.type}</p>
          <p className="text-xs text-muted-foreground">{a.reason}</p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      className: "tabular-nums",
      cell: (a) => (a.amount ? money(a.amount) : "—"),
    },
    {
      key: "status",
      header: "Status",
      cell: (a) => <StatusPill tone={tone[a.status]}>{label(a.status)}</StatusPill>,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (a) =>
        a.status !== "pending" ? null : demo || !uuidLike(a.id) ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex gap-1">
                <Button size="sm" variant="outline" disabled>
                  <Check />
                  Approve
                </Button>
                <Button size="sm" variant="ghost" disabled>
                  <X />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Demonstration rows can't be approved.</TooltipContent>
          </Tooltip>
        ) : (
          <span className="inline-flex gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => act(a, "approved")}
            >
              {busy === a.id ? <Loader2 className="animate-spin" /> : <Check />}Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Reject"
              disabled={!!busy}
              onClick={() => act(a, "rejected")}
            >
              <X />
            </Button>
          </span>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Escalation Center"
        description="Requests your agent could not resolve on its own."
        actions={demo && <DemoBadge />}
      />
      <DevpilotJourneyPanel focus="approval" />
      <div className="mb-4 flex items-start gap-2 rounded-lg border bg-surface px-4 py-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-cyan" />
        Decisions are checked and saved by the server. Approving lets the customer accept the offer;
        it never changes billing by itself — PayPal changes happen only after the customer accepts
        and PayPal confirms.
      </div>
      <DataGate
        hasRows={data.approvals.length > 0}
        emptyTitle="No escalations"
        emptyDescription="When the agent needs your sign-off — like a discount above your limit — it appears here."
      >
        <DataTable
          table={table}
          columns={columns}
          search="Search escalations"
          statuses={[
            { value: "pending", label: "Pending" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
          ]}
        />
      </DataGate>
    </>
  );
}
