import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill, label } from "@/components/dashboard/ui";
import { authStore } from "@/lib/firebase/auth";
import { generateRetentionOffer } from "@/lib/retention/retention.functions";
import {
  confirmSubscriptionRevision,
  fetchSubscription,
  recordCustomerDecision,
  startSandboxSubscription,
  type SubscriptionDTO,
} from "@/lib/paypal/paypal.functions";
import { DEVPILOT, canStartCheckout } from "@/lib/paypal/journey";
import { speakRetentionMessage } from "@/lib/notify/voice.functions";
import { useJourney } from "@/lib/paypal/journey-store";
import {
  bindSubscription,
  logPaypalReturnCancelled,
  resetJourney,
} from "@/lib/records/records.functions";
import {
  CANCELLATION_REASONS,
  DEFAULT_POLICY,
  type BrandProfile,
  type CancellationReason,
} from "@/lib/retention/guardrails";

export const Route = createFileRoute("/_authenticated/portal/devpilot")({
  head: () => ({
    meta: [
      { title: "Manage your DevPilot AI Pro subscription" },
      {
        name: "description",
        content:
          "Customer subscription portal for DevPilot AI Pro, a fictional demo merchant powered by RETAIN.AI.",
      },
      { property: "og:title", content: "DevPilot AI Pro · Manage subscription" },
      { property: "og:description", content: "Demo customer portal powered by RETAIN.AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Portal,
});

const DEVPILOT_PROFILE: BrandProfile = {
  businessName: "DevPilot AI",
  website: "https://devpilot.example.com",
  description:
    "DevPilot AI (fictional) is an AI coding assistant that helps developers write, review and refactor code faster.",
  products: [`DevPilot AI Pro Monthly — $${DEVPILOT.monthlyPrice}/month`],
  audience: "Professional and indie software developers",
  tone: "Friendly, direct, developer-to-developer",
  publicFacts: ["Fictional demonstration merchant for the RETAIN.AI hackathon demo"],
};
const REASON_COPY: Record<CancellationReason, string> = {
  too_expensive: "It's too expensive",
  not_using: "I'm not using it enough",
  missing_features: "It's missing features I need",
  technical_issues: "I've had technical problems",
  switching_competitor: "I'm switching to another tool",
  temporary_break: "I just need a break",
  other: "Something else",
};
const uuid = () => crypto.randomUUID();
async function idToken() {
  const u = authStore.getSnapshot().user;
  if (!u) throw new Error("Please sign in again.");
  return u.getIdToken();
}

function Portal() {
  const snap = useSyncExternalStore(
    authStore.subscribe,
    authStore.getSnapshot,
    authStore.getServerSnapshot,
  );
  const uid = snap.user?.uid;
  const { journey: j, state: jState, error: jError, reload } = useJourney(uid);
  const bind = useServerFn(bindSubscription);
  const logCancelled = useServerFn(logPaypalReturnCancelled);
  const reset = useServerFn(resetJourney);
  const fetchSub = useServerFn(fetchSubscription);
  const startSub = useServerFn(startSandboxSubscription);
  const genOffer = useServerFn(generateRetentionOffer);
  const decide = useServerFn(recordCustomerDecision);
  const confirmRevision = useServerFn(confirmSubscriptionRevision);
  const [sub, setSub] = useState<SubscriptionDTO | null>(null);
  const [subError, setSubError] = useState<string | null>(null);
  const [loadingSub, setLoadingSub] = useState(false);
  const [step, setStep] = useState<"view" | "reason" | "offer">("view");
  const [reason, setReason] = useState<CancellationReason>("too_expensive");
  const [detail, setDetail] = useState(
    `I'm cancelling because $${DEVPILOT.monthlyPrice}/month is too expensive for me.`,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);

  const refresh = useCallback(
    async (id: string) => {
      setLoadingSub(true);
      setSubError(null);
      try {
        const r = await fetchSub({ data: { idToken: await idToken(), subscriptionId: id } });
        if (r.ok) {
          setSub(r.subscription);
          if (r.subscription.ownedByYou)
            await bind({
              data: { idToken: await idToken(), subscriptionId: id, event: "refresh" },
            });
        } else setSubError(r.error);
      } catch (e) {
        setSubError(e instanceof Error ? e.message : "Could not reach PayPal.");
      } finally {
        setLoadingSub(false);
      }
    },
    [fetchSub, bind],
  );

  // Handle return from PayPal approval, then load the bound subscription.
  const handled = useRef(false);
  useEffect(() => {
    if (!uid || jState !== "ready" || handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    const returned = params.get("subscription_id");
    void (async () => {
      if (params.get("paypal") === "approved" && returned) {
        window.history.replaceState({}, "", "/portal/devpilot");
        const r = await bind({
          data: { idToken: await idToken(), subscriptionId: returned, event: "approved_return" },
        });
        if (!r.ok) toast.error(r.error);
        await reload();
        void refresh(returned);
      } else if (params.get("paypal") === "revised") {
        window.history.replaceState({}, "", "/portal/devpilot");
        const sid = params.get("subscription_id") ?? params.get("sub") ?? j.subscriptionId;
        const sessionId = params.get("session_id");
        if (sid) {
          const r = await confirmRevision({
            data: {
              idToken: await idToken(),
              subscriptionId: sid,
              offerRequestId: sessionId || null,
            },
          });
          if (!r.ok) toast.error(r.error);
          else if (r.verified) toast.success(r.reason);
          else toast(r.reason);
          await reload();
          await refresh(sid);
        }
      } else if (params.get("paypal") === "revision_cancelled") {
        window.history.replaceState({}, "", "/portal/devpilot");
        toast("No price change was made — your subscription stays as it is.");
        await reload();
        if (j.subscriptionId) void refresh(j.subscriptionId);
      } else if (params.get("paypal") === "cancelled") {
        window.history.replaceState({}, "", "/portal/devpilot");
        await logCancelled({ data: { idToken: await idToken() } });
        await reload();
        if (j.subscriptionId) void refresh(j.subscriptionId);
      } else if (j.subscriptionId) {
        // Resume an open offer after a refresh instead of losing it.
        if (j.currentSessionId && j.decision && !j.customerChoice) setStep("offer");
        void refresh(j.subscriptionId);
      }
    })();
  }, [uid, jState]); // eslint-disable-line react-hooks/exhaustive-deps

  const guard = async (name: string, fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };

  const connect = () =>
    guard("connect", async () => {
      const r = await startSub({ data: { idToken: await idToken(), requestId: uuid() } });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      window.location.href = r.approveUrl;
    });

  // The server replaces these with the workspace's saved policy and approved profile.
  const policy = DEFAULT_POLICY;
  const profile: BrandProfile = DEVPILOT_PROFILE;

  const submitReason = () =>
    guard("offer", async () => {
      const requestId = uuid();
      const r = await genOffer({
        data: {
          idToken: await idToken(),
          requestId,
          profile,
          policy,
          reason,
          reasonDetail: detail,
          subscription: {
            planName: DEVPILOT.planDisplayName,
            monthlyPrice: sub?.amount ?? DEVPILOT.monthlyPrice,
            monthsActive: 1,
          },
          persist: true,
          previousOffers: j.decision?.offer
            ? [
                {
                  type: j.decision.offer.type,
                  discountPct: j.decision.offer.discountPct,
                  title: j.decision.offer.title,
                },
              ].slice(0, j.offersMade)
            : [],
        },
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      await reload();
      setStep("offer");
    });

  const act = (action: "accept_offer" | "decline_offer" | "continue_cancellation") =>
    guard(action, async () => {
      const cur = j;
      if (!cur.subscriptionId) {
        toast.error("Connect a PayPal Sandbox subscription first.");
        return;
      }
      const r = await decide({
        data: {
          idToken: await idToken(),
          actionId: uuid(),
          subscriptionId: cur.subscriptionId,
          action,
          consent: true,
          offerRequestId: cur.currentSessionId,
        },
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      // A price revision can require the customer's consent on PayPal.
      if (r.approveUrl) {
        window.location.href = r.approveUrl;
        return;
      }
      await reload();
      if (cur.subscriptionId) await refresh(cur.subscriptionId);
      if (action === "decline_offer") setStep("reason");
    });

  const resetDemo = () =>
    guard("reset", async () => {
      const r = await reset({ data: { idToken: await idToken() } });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setSub(null);
      setStep("view");
      await reload();
    });

  const status = sub?.status ?? null;
  const showCheckout = canStartCheckout(
    !!j.subscriptionId,
    status,
    jState === "ready" && !loadingSub,
  );
  const d = j.decision;
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-lg font-semibold tracking-tight">DevPilot AI</p>
            <p className="text-xs text-muted-foreground">
              Fictional demo merchant · retention powered by RETAIN.AI
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              <ArrowLeft className="size-4" />
              Merchant dashboard
            </Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <div className="rounded-lg border border-cyan/25 bg-cyan/10 px-4 py-3 text-xs text-cyan">
          You're viewing the <b>customer</b> side of the demo. Billing runs in PayPal <b>Sandbox</b>{" "}
          — no real money moves. Journey history is saved to the merchant's workspace.
        </div>

        {showCheckout && step === "view" && (
          <section className="rounded-2xl border-2 border-cyan/40 bg-cyan/5 p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan">
              Start here · about 1 minute
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {j.subscriptionId
                ? "Start a fresh Sandbox subscription"
                : "Connect a Sandbox subscription"}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Create the baseline DevPilot AI Pro subscription, then come back and cancel it to
              trigger the AI retention offer.
            </p>
            <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <li className="rounded-lg border bg-background/60 px-3 py-2">
                <span className="font-medium">Step 1</span> ·{" "}
                {`Subscribe for $${DEVPILOT.monthlyPrice}/month`}
              </li>
              <li className="rounded-lg border bg-background/60 px-3 py-2">
                <span className="font-medium">Step 2</span> · Click “Cancel subscription”
              </li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              No real money moves. PayPal Sandbox approval takes a few clicks.
            </p>
            <Button size="lg" className="mt-4 w-full sm:w-auto" onClick={connect} disabled={!!busy}>
              {busy === "connect" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ExternalLink className="size-4" />
              )}
              Start Sandbox Subscription — ${DEVPILOT.monthlyPrice}/mo
            </Button>
          </section>
        )}

        <section className="rounded-2xl border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Your subscription
              </p>
              <h1 className="mt-1 text-2xl font-semibold">{DEVPILOT.productName}</h1>
              <p className="text-sm text-muted-foreground">
                {DEVPILOT.planName} ·{" "}
                <span className="tabular-nums">
                  ${showCheckout ? DEVPILOT.monthlyPrice : (sub?.amount ?? DEVPILOT.monthlyPrice)}
                </span>
                /month {showCheckout ? DEVPILOT.currency : (sub?.currency ?? DEVPILOT.currency)}
              </p>
            </div>
            {status ? (
              <StatusPill
                tone={
                  status === "ACTIVE"
                    ? "success"
                    : status === "SUSPENDED"
                      ? "violet"
                      : status === "CANCELLED"
                        ? "muted"
                        : "warning"
                }
              >
                PayPal: {label(status.toLowerCase())}
              </StatusPill>
            ) : (
              <StatusPill tone="muted">Not connected</StatusPill>
            )}
          </div>
          {j.subscriptionId ? (
            <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <span>
                PayPal subscription{" "}
                <span className="font-mono text-foreground">{j.subscriptionId}</span>
              </span>
              <span>
                Next billing:{" "}
                {sub?.nextBillingTime ? new Date(sub.nextBillingTime).toLocaleString() : "—"}
              </span>
              <span>
                Last payment:{" "}
                {sub?.lastPayment
                  ? `${sub.lastPayment.amount} ${sub.lastPayment.currency}`
                  : "none yet"}
              </span>
              <span className="flex items-center gap-1">
                {loadingSub ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <ShieldCheck className="size-3 text-success" />
                )}
                Status read live from PayPal Sandbox
                <button
                  className="ml-1 underline"
                  onClick={() => j.subscriptionId && refresh(j.subscriptionId)}
                >
                  <RefreshCw className="inline size-3" />
                </button>
              </span>
              {sub && !sub.ownedByYou && (
                <span className="text-destructive sm:col-span-2">
                  This subscription was not created for your account; changes will be refused.
                </span>
              )}
            </div>
          ) : null}
          <div className="mt-4 flex items-center gap-2 border-t pt-4 text-sm">
            <ExternalLink className="size-4 text-cyan" />
            <span className="font-medium">PayPal</span>
            <StatusPill tone="muted">Sandbox</StatusPill>
          </div>
          {subError && (
            <p className="mt-3 flex items-center gap-1 text-sm text-destructive">
              <CircleAlert className="size-4" />
              {subError}
            </p>
          )}
          {status === "ACTIVE" && step === "view" && (
            <div className="mt-4 rounded-xl border border-dashed border-violet/40 bg-violet/5 p-4">
              <p className="text-sm font-semibold">Step 2 — Try cancelling</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Tell us why you want to leave and the AI will respond with a retention offer.
              </p>
              <Button size="lg" className="mt-3" onClick={() => setStep("reason")}>
                Cancel subscription
              </Button>
            </div>
          )}
          {status === "SUSPENDED" && (
            <Button
              variant="outline"
              className="mt-4"
              disabled={!!busy}
              onClick={() => act("continue_cancellation")}
            >
              {busy === "continue_cancellation" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Cancel subscription
            </Button>
          )}
          {status === "SUSPENDED" && (
            <p className="mt-4 text-sm text-violet">
              Your subscription is paused in PayPal. No charges until it's resumed.
            </p>
          )}
          {status === "CANCELLED" && (
            <p className="mt-4 text-sm">
              PayPal confirms your subscription is cancelled. You won't be charged again.
            </p>
          )}
        </section>

        {status === "ACTIVE" && step !== "view" && (
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="font-semibold">Sorry to see you go — what's the main reason?</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {CANCELLATION_REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition ${reason === r ? "border-violet bg-violet/10" : "hover:bg-muted"}`}
                >
                  {REASON_COPY[r]}
                </button>
              ))}
            </div>
            <Textarea
              className="mt-3"
              rows={2}
              maxLength={500}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Tell us more (optional)"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={submitReason} disabled={!!busy}>
                {busy === "offer" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Continue
              </Button>
              <Button
                variant="ghost"
                onClick={() => act("continue_cancellation")}
                disabled={!!busy}
              >
                {busy === "continue_cancellation" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Skip and cancel now
              </Button>
            </div>
          </section>
        )}

        {status === "ACTIVE" && step === "offer" && d && (
          <section className="rounded-2xl border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm leading-relaxed">{d.message}</p>
              <ListenButton text={d.message} />
            </div>
            {d.offer && (
              <div className="mt-4 rounded-xl border border-violet/30 bg-violet/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{d.offer.title}</p>
                  {d.status === "needs_approval" && (
                    <StatusPill tone="warning">Waiting for DevPilot to approve</StatusPill>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {label(d.offer.type)}
                  {d.offer.discountPct ? ` · ${d.offer.discountPct}% off` : ""} ·{" "}
                  {d.offer.durationMonths} month(s)
                </p>
                {d.offer.type === "discount" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Accepting applies this price to your PayPal subscription. PayPal may ask you to
                    approve the new price before it starts.
                  </p>
                )}
                {(d.offer.type === "downgrade" || d.offer.type === "skip_month") && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Accepting records your choice. DevPilot will follow up — your billing doesn't
                    change until then.
                  </p>
                )}
              </div>
            )}
            {j.paypalReason && j.customerChoice && (
              <p
                className={`mt-3 text-sm ${j.paypalOutcome === "verified" ? "text-success" : j.paypalOutcome === "paypal_failed" || j.paypalOutcome === "rejected" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {j.paypalReason}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {d.offer && d.status === "offer" && j.customerChoice !== "accepted" && (
                <Button onClick={() => act("accept_offer")} disabled={!!busy}>
                  {busy === "accept_offer" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  Accept offer
                </Button>
              )}
              {d.offer && j.customerChoice !== "accepted" && (
                <Button variant="outline" onClick={() => act("decline_offer")} disabled={!!busy}>
                  No thanks
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => act("continue_cancellation")}
                disabled={!!busy}
              >
                {busy === "continue_cancellation" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <XCircle className="size-4" />
                )}
                Continue cancellation
              </Button>
            </div>
          </section>
        )}

        {jState === "loading" && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Loading saved journey…
          </p>
        )}
        {jState === "error" && (
          <p className="flex items-center gap-1 text-sm text-destructive">
            <CircleAlert className="size-4" />
            {jError}
          </p>
        )}
        <section className="rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Activity</h2>
            {j.subscriptionId && (
              <button className="text-xs text-muted-foreground underline" onClick={resetDemo}>
                Reset demo
              </button>
            )}
          </div>
          {j.audit.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Nothing yet.</p>
          ) : (
            <ol className="mt-3 space-y-2">
              {j.audit.slice(0, 12).map((a, i) => (
                <li key={i} className="text-xs">
                  <span className="text-muted-foreground">
                    {new Date(a.at).toLocaleTimeString()}
                  </span>{" "}
                  · <span className="font-medium">{label(a.kind)}</span>
                  {a.verified === true && (
                    <span className="text-success"> · verified by PayPal</span>
                  )}
                  {a.verified === false && a.kind.startsWith("paypal") && (
                    <span className="text-warning"> · not verified</span>
                  )}
                  <div className="text-muted-foreground">{a.detail}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}

function ListenButton({ text }: { text: string }) {
  const speakFn = useServerFn(speakRetentionMessage);
  const [busy, setBusy] = useState(false);
  async function play() {
    setBusy(true);
    try {
      const r = await speakFn({ data: { idToken: await idToken(), text } });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      await new Audio(`data:audio/mpeg;base64,${r.audio}`).play();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't play the voice message.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={play}
      disabled={busy}
      aria-label="Listen to this message"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Volume2 className="size-4" />}Listen
    </Button>
  );
}
