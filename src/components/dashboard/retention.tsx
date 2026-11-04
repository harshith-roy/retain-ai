import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, FlaskConical, Globe, Loader2, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel, StatusPill, label } from "@/components/dashboard/ui";
import { authStore } from "@/lib/firebase/auth";
import { analyzeWebsite, generateRetentionOffer } from "@/lib/retention/retention.functions";
import { getRetentionSettings, saveRetentionSettings } from "@/lib/records/records.functions";
import { ALTERNATIVES, CANCELLATION_REASONS, DEFAULT_POLICY, HARD_LIMITS, PolicySchema, type BrandProfile, type CancellationReason, type Decision, type Offer, type RetentionPolicy } from "@/lib/retention/guardrails";

const legacy = (merchantId: string) => ({
  load<T>(k: string): T | null { try { const r = localStorage.getItem(`retain.dev.${merchantId}.${k}`); return r ? (JSON.parse(r) as T) : null; } catch { return null; } },
  clear() { for (const k of ["profile", "approved", "policy"]) localStorage.removeItem(`retain.dev.${merchantId}.${k}`); },
});
async function idToken() { const u = authStore.getSnapshot().user; if (!u) throw new Error("Please sign in again."); return u.getIdToken(); }

export function RetentionWorkflow({ merchantId }: { merchantId: string }) {
  const load = useServerFn(getRetentionSettings);
  const save = useServerFn(saveRetentionSettings);
  const [profile, setProfile] = useState<BrandProfile | null>(null);
  const [approved, setApproved] = useState(false);
  const [policy, setPolicy] = useState<RetentionPolicy>(DEFAULT_POLICY);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [migrated, setMigrated] = useState(false);

  useEffect(() => { void (async () => {
    try {
      const r = await load({ data: { idToken: await idToken() } });
      if (!r.ok) { setState("error"); setError(r.error); return; }
      const l = legacy(merchantId);
      if (!r.exists && (l.load("profile") || l.load("policy"))) {
        // Earlier versions kept these only in this browser: move them into the workspace once.
        const lp = PolicySchema.safeParse(l.load("policy"));
        const next = { profile: l.load<BrandProfile>("profile"), profileApproved: !!l.load("approved"), policy: lp.success ? lp.data : DEFAULT_POLICY };
        const w = await save({ data: { idToken: await idToken(), ...next } });
        if (w.ok) { l.clear(); setMigrated(true); setProfile(next.profile); setApproved(next.profileApproved); setPolicy(next.policy); setState("ready"); return; }
      }
      setProfile(r.profile); setApproved(r.profileApproved); setPolicy(r.policy ?? DEFAULT_POLICY); setState("ready");
    } catch (e) { setState("error"); setError(e instanceof Error ? e.message : "Settings could not be loaded."); }
  })(); }, [merchantId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function persist(next: { profile: BrandProfile | null; profileApproved: boolean; policy: RetentionPolicy }) {
    const prev = { profile, approved, policy };
    setProfile(next.profile); setApproved(next.profileApproved); setPolicy(next.policy);
    try { const r = await save({ data: { idToken: await idToken(), ...next } }); if (!r.ok) throw new Error(r.error); }
    catch (e) { setProfile(prev.profile); setApproved(prev.approved); setPolicy(prev.policy); toast.error(e instanceof Error ? e.message : "Could not save to your workspace."); return false; }
    return true;
  }

  if (state === "loading") return <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading saved retention settings…</div>;
  if (state === "error") return <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">Retention settings could not be loaded: {error}</div>;
  return <div className="mt-6 space-y-4">
    <div className="flex items-start gap-2 rounded-lg border border-cyan/25 bg-cyan/10 px-4 py-3 text-xs text-cyan"><FlaskConical className="mt-0.5 size-4 shrink-0" />Brand profile and policies are saved to your workspace. The customer portal always uses these saved limits, and every AI offer is re-checked on the server.{migrated && " Settings previously kept in this browser were moved into your workspace."}</div>
    <Onboarding profile={profile} approved={approved} onChange={(p, a) => { void persist({ profile: p, profileApproved: a, policy }); }} />
    <Policies policy={policy} onSave={async (p) => { if (await persist({ profile, profileApproved: approved, policy: p })) toast.success("Policy saved to your workspace"); }} />
    <SessionTester profile={approved ? profile : null} policy={policy} />
  </div>;
}

function Onboarding({ profile, approved, onChange }: { profile: BrandProfile | null; approved: boolean; onChange: (p: BrandProfile | null, approved: boolean) => void }) {
  const analyze = useServerFn(analyzeWebsite);
  const [name, setName] = useState(profile?.businessName ?? "");
  const [url, setUrl] = useState(profile?.website ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (profile) { setName(profile.businessName); setUrl(profile.website); } }, [profile]);
  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await analyze({ data: { idToken: await idToken(), businessName: name.trim(), website: url.trim() } });
      if (!r.ok) { setError(r.error); return; }
      onChange(r.profile, false); toast.success("Website analyzed", { description: `Read ${r.sourceChars.toLocaleString()} characters. Review before approving.` });
    } catch (e) { setError(e instanceof Error ? e.message : "Analysis failed."); } finally { setBusy(false); }
  }
  const edit = (patch: Partial<BrandProfile>) => profile && onChange({ ...profile, ...patch }, false);
  const valid = name.trim() && /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(url.trim());
  return <Panel title="1 · Merchant onboarding" description="Analyze your public website to build a brand profile" action={profile && <StatusPill tone={approved ? "success" : "warning"}>{approved ? "Approved" : "Needs review"}</StatusPill>}>
    <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
      <div className="space-y-1.5"><Label htmlFor="bname">Business name</Label><Input id="bname" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="burl">Website URL</Label><Input id="burl" type="url" placeholder="https://yourstore.com" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
      <Button onClick={run} disabled={!valid || busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}{busy ? "Analyzing…" : "Analyze website"}</Button>
    </div>
    {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    {profile && <div className="mt-5 grid gap-3 md:grid-cols-2">
      <TextBlock label="Business description" value={profile.description} onChange={(v) => edit({ description: v })} rows={4} />
      <TextBlock label="Products (one per line)" value={profile.products.join("\n")} onChange={(v) => edit({ products: v.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 12) })} rows={4} />
      <TextBlock label="Audience" value={profile.audience} onChange={(v) => edit({ audience: v })} rows={2} />
      <TextBlock label="Tone" value={profile.tone} onChange={(v) => edit({ tone: v })} rows={2} />
      <div className="md:col-span-2"><TextBlock label="Public information (one per line)" value={profile.publicFacts.join("\n")} onChange={(v) => edit({ publicFacts: v.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 10) })} rows={3} /></div>
      <p className="text-xs text-muted-foreground md:col-span-2">Extracted from your website by AI. Website text is treated as untrusted — instructions in it are ignored.</p>
      <div className="flex gap-2 md:col-span-2"><Button onClick={() => { onChange(profile, true); toast.success("Brand profile approved"); }} disabled={approved}><CheckCircle2 className="size-4" />Approve profile</Button><Button variant="ghost" onClick={() => onChange(null, false)}>Discard</Button></div>
    </div>}
  </Panel>;
}

function TextBlock({ label: l, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows: number }) {
  return <div className="space-y-1.5"><Label>{l}</Label><Textarea rows={rows} value={value} maxLength={1200} onChange={(e) => onChange(e.target.value)} /></div>;
}

function Policies({ policy, onSave }: { policy: RetentionPolicy; onSave: (p: RetentionPolicy) => void | Promise<void> }) {
  const [draft, setDraft] = useState(policy);
  useEffect(() => setDraft(policy), [policy]);
  const check = PolicySchema.safeParse(draft);
  const set = <K extends keyof RetentionPolicy>(k: K, v: RetentionPolicy[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const num = (v: string) => (v === "" ? NaN : Number(v));
  return <Panel title="2 · Retention policies" description="Hard limits the AI cannot change" action={<Button size="sm" disabled={!check.success || JSON.stringify(draft) === JSON.stringify(policy)} onClick={() => onSave(draft)}>Save policy</Button>}>
    <div className="grid gap-4 md:grid-cols-3">
      <div className="space-y-1.5"><Label htmlFor="pmax">Max automated discount (%)</Label><Input id="pmax" type="number" min={0} max={HARD_LIMITS.maxDiscountPct} value={draft.maxDiscountPct} onChange={(e) => set("maxDiscountPct", num(e.target.value))} /></div>
      <div className="space-y-1.5"><Label htmlFor="poffers">Max offers per session</Label><Input id="poffers" type="number" min={1} max={HARD_LIMITS.maxOffers} value={draft.maxOffers} onChange={(e) => set("maxOffers", num(e.target.value))} /></div>
      <div className="space-y-1.5"><Label htmlFor="pesc">Escalate when annual value exceeds ($)</Label><Input id="pesc" type="number" min={0} value={draft.escalateAboveValue} onChange={(e) => set("escalateAboveValue", num(e.target.value))} /></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-4">{ALTERNATIVES.map((a) => <label key={a} className="flex items-center gap-2 text-sm"><Checkbox checked={draft.allowedAlternatives.includes(a)} onCheckedChange={(c) => set("allowedAlternatives", c ? [...draft.allowedAlternatives, a] : draft.allowedAlternatives.filter((x) => x !== a))} />{label(a)}</label>)}</div>
    <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border p-3"><div><Label htmlFor="papprove">Require human approval for every offer</Label><p className="text-xs text-muted-foreground">Offers wait for you instead of being shown as available.</p></div><Switch id="papprove" checked={draft.requireHumanApproval} onCheckedChange={(v) => set("requireHumanApproval", v)} /></div>
    {!check.success && <p className="mt-3 text-xs text-destructive">Invalid policy: discount 0–{HARD_LIMITS.maxDiscountPct}%, 1–{HARD_LIMITS.maxOffers} offers, at least one alternative, whole numbers.</p>}
  </Panel>;
}

type SessionStatus = "choosing" | "offered" | "awaiting_approval" | "pending_subscription_action" | "cancelled";
const statusTone = { choosing: "muted", offered: "cyan", awaiting_approval: "warning", pending_subscription_action: "violet", cancelled: "muted" } as const;

function SessionTester({ profile, policy }: { profile: BrandProfile | null; policy: RetentionPolicy }) {
  const generate = useServerFn(generateRetentionOffer);
  const [reason, setReason] = useState<CancellationReason>("too_expensive");
  const [detail, setDetail] = useState("");
  const [status, setStatus] = useState<SessionStatus>("choosing");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const reset = () => { setStatus("choosing"); setDecision(null); setOffers([]); setDetail(""); };

  async function ask() {
    if (!profile || inflight.current) return;
    inflight.current = true; setBusy(true);
    try {
      const r = await generate({ data: { idToken: await idToken(), requestId: crypto.randomUUID(), profile, policy, reason, reasonDetail: detail, subscription: { planName: "DevPilot AI Pro Monthly", monthlyPrice: 29, monthsActive: 8 }, previousOffers: offers.map((o) => ({ type: o.type, discountPct: o.discountPct, title: o.title })) } });
      if (!r.ok) { toast.error(r.error); return; }
      setDecision(r.decision);
      if (r.decision.offer) setOffers((o) => [...o, r.decision.offer as Offer]);
      setStatus(r.decision.status === "needs_approval" ? "awaiting_approval" : "offered");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Request failed"); } finally { inflight.current = false; setBusy(false); }
  }

  return <Panel title="3 · Customer retention session" description="Test what a cancelling customer sees (DevPilot AI Pro Monthly, $29/month)" action={<StatusPill tone={statusTone[status]}>{label(status)}</StatusPill>}>
    {!profile ? <p className="text-sm text-muted-foreground">Approve a brand profile above to start a test session.</p> : <div className="space-y-4">
      {status !== "cancelled" && status !== "pending_subscription_action" && <>
        <div className="flex flex-wrap gap-2">{CANCELLATION_REASONS.map((r) => <Button key={r} size="sm" variant={reason === r ? "default" : "outline"} onClick={() => setReason(r)}>{label(r)}</Button>)}</div>
        <Textarea rows={2} maxLength={500} placeholder="Anything else the customer says (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
        <Button onClick={ask} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{decision ? "Ask for another option" : "Send reason"}</Button>
      </>}
      {decision && <div className="rounded-xl border bg-card/60 p-4">
        <p className="text-sm leading-relaxed">{decision.message}</p>
        {decision.offer && <div className="mt-4 rounded-lg border border-violet/30 bg-violet/10 p-4">
          <div className="flex items-center justify-between gap-2"><p className="font-medium">{decision.offer.title}</p>{decision.status === "needs_approval" && <StatusPill tone="warning">Needs merchant approval</StatusPill>}</div>
          <p className="mt-1 text-xs text-muted-foreground">{label(decision.offer.type)}{decision.offer.discountPct ? ` · ${decision.offer.discountPct}% off` : ""} · {decision.offer.durationMonths} month(s)</p>
          <p className="mt-2 text-xs text-muted-foreground">Why: {decision.rationale}</p>
        </div>}
        {!decision.offer && <p className="mt-3 text-xs text-muted-foreground">No offer: {decision.rationale}</p>}
        {decision.violations.length > 0 && <p className="mt-2 flex items-center gap-1 text-xs text-warning"><ShieldCheck className="size-3.5" />Guardrails applied: {decision.violations.map(label).join(", ")}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {decision.offer && decision.status === "offer" && status === "offered" && <Button onClick={() => setStatus("pending_subscription_action")}><CheckCircle2 className="size-4" />Accept offer</Button>}
          {status !== "cancelled" && status !== "pending_subscription_action" && <Button variant="outline" onClick={() => setStatus("cancelled")}><XCircle className="size-4" />Continue cancellation</Button>}
        </div>
      </div>}
      {status === "pending_subscription_action" && <p className="text-sm text-violet">Offer accepted — pending subscription action. No PayPal subscription has been changed yet.</p>}
      {status === "cancelled" && <p className="text-sm text-muted-foreground">Customer chose to continue cancelling. (Test only — no subscription was cancelled.)</p>}
      {(status === "cancelled" || status === "pending_subscription_action") && <Button variant="ghost" size="sm" onClick={reset}>Start new test session</Button>}
      <p className="text-xs text-muted-foreground">Offers used this session: {offers.length} / {policy.maxOffers}</p>
    </div>}
  </Panel>;
}
