import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { useFirebaseAuth } from "@/hooks/use-firebase-auth";
import { PageHeader, Panel } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getTeam, inviteMember, revokeInvite } from "@/lib/records/records.functions";

export const Route = createFileRoute("/_authenticated/dashboard/settings")({
  head: () => ({
    meta: [
      { title: "Settings · RETAIN.AI" },
      {
        name: "description",
        content: "Your merchant account, workspace identity and team invitations.",
      },
      { property: "og:title", content: "Settings · RETAIN.AI" },
      { property: "og:description", content: "Workspace settings and team access." },
    ],
  }),
  component: SettingsPage,
});

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 py-3 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className={mono ? "break-all font-mono text-xs" : ""}>{v}</span>
    </div>
  );
}

function SettingsPage() {
  const { user, merchant, merchantId, role } = useFirebaseAuth();
  return (
    <>
      <PageHeader title="Settings" description="Your account, workspace and team." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Merchant account">
          <div className="-my-3 divide-y">
            <Row k="Name" v={user?.displayName || "Merchant"} />
            <Row k="Email" v={user?.email ?? "—"} />
            <Row k="Role" v={role === "approver" ? "Approver" : "Owner"} />
            <Row k="Sign-in" v="Google" />
          </div>
        </Panel>
        <Panel title="Workspace">
          <div className="-my-3 divide-y">
            <Row k="Workspace" v={merchant?.name ?? "—"} />
            <Row k="Merchant ID" v={merchantId ?? "—"} mono />
            <Row k="Firebase project" v="fir-4700f" mono />
            <Row k="Created" v={merchant?.createdAt?.toDate().toLocaleDateString() ?? "—"} />
          </div>
        </Panel>
        {role === "owner" && <TeamPanel />}
      </div>
    </>
  );
}

type Invite = { id: string; email: string; role: string; status: string; expiresAt: string };

function TeamPanel() {
  const { user } = useFirebaseAuth();
  const list = useServerFn(getTeam),
    invite = useServerFn(inviteMember),
    revoke = useServerFn(revokeInvite);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useCallback(async () => {
    if (!user) throw new Error("Please sign in again.");
    return user.getIdToken();
  }, [user]);
  const load = useCallback(async () => {
    const r = await list({ data: { idToken: await token() } });
    if (r.ok) setInvites(r.invites);
    else setMsg(r.error);
  }, [list, token]);
  useEffect(() => {
    void load();
  }, [load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await invite({ data: { idToken: await token(), email, role: "approver" } });
      if (r.ok) {
        setEmail("");
        setMsg("Invitation saved. They can now sign in with Google using that email.");
        await load();
      } else setMsg(r.error);
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    const r = await revoke({ data: { idToken: await token(), inviteId: id } });
    if (!r.ok) setMsg(r.error);
    await load();
  }

  return (
    <Panel title="Team access">
      <p className="mb-3 text-sm text-muted-foreground">
        RETAIN.AI is invitation-only. Approvers can review and decide retention offers in the
        Escalation Center, but never offers made to their own subscription.
      </p>
      <form onSubmit={send} className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          required
          placeholder="teammate@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Teammate email"
        />
        <Button type="submit" disabled={busy}>
          Invite approver
        </Button>
      </form>
      {msg && (
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          {msg}
        </p>
      )}
      <div className="mt-4 divide-y text-sm">
        {invites.length === 0 && <p className="py-2 text-muted-foreground">No invitations yet.</p>}
        {invites.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="break-all">{i.email}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {i.status}
              {i.status === "pending" && (
                <Button size="sm" variant="ghost" onClick={() => void cancel(i.id)}>
                  Revoke
                </Button>
              )}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
