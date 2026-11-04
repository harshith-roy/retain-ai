import { inngest } from "./inngest-client.server";

/** Durable workflows. Inngest retries each step automatically on failure. */
export { inngest };

export const ESCALATION_DELAY = "15m";

/** Approval requested â†’ notify Slack â†’ wait â†’ escalate if still pending. */
export const approvalEscalation = inngest.createFunction(
  { id: "approval-escalation", retries: 4, triggers: [{ event: "retain/approval.requested" }] },
  async ({ event, step }) => {
    const d = event.data as {
      merchantId: string;
      approvalId: string;
      customerName: string;
      offerTitle: string;
      reason: string;
      amount: number;
      reviewUrl: string;
    };
    await step.run("notify-slack", async () => {
      const n = await import("./notify.server");
      const r = await n.slackPost(
        `Retention offer needs approval: ${d.offerTitle} for ${d.customerName}`,
        n.approvalBlocks(d),
      );
      if (!r.ok) throw new Error(r.error); // retried by Inngest
      return r;
    });
    await step.sleep("escalation-timeout", ESCALATION_DELAY);
    return step.run("escalate-if-pending", async () => {
      const { getDoc, commit } = await import("@/lib/firebase/admin.server");
      const a = await getDoc(`merchants/${d.merchantId}/approvals/${d.approvalId}`);
      if (!a || a["status"] !== "pending")
        return { escalated: false, status: a?.["status"] ?? "missing" };
      const n = await import("./notify.server");
      const r = await n.slackPost(
        `Escalation: approval still pending for ${d.customerName}`,
        n.approvalBlocks({ ...d, escalated: true }),
      );
      if (!r.ok) throw new Error(r.error);
      await commit([
        {
          op: "merge",
          path: `merchants/${d.merchantId}/approvals/${d.approvalId}`,
          data: { escalatedAt: new Date().toISOString() },
        },
      ]);
      await n.capture("approval_escalated", d.merchantId, { approvalId: d.approvalId });
      return { escalated: true };
    });
  },
);

export const functions = [approvalEscalation];
