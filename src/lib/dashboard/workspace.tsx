import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase/client";
import { listenToMerchantData, type MerchantCollection } from "@/lib/firebase/data";
import { makeDemoData, normalise, type Dataset, type RangeKey } from "./model";

export type LoadState = "loading" | "ready" | "error";
interface Workspace {
  merchantId: string;
  range: RangeKey; setRange: (r: RangeKey) => void;
  demo: boolean; setDemo: (on: boolean) => void;
  /** Firestore data, or demonstration data when demo mode is on. */
  data: Dataset; live: Dataset;
  state: LoadState; error: string | null;
  now: Date;
}
const Ctx = createContext<Workspace | null>(null);
const EMPTY: Dataset = { customers: [], subscriptions: [], sessions: [], approvals: [] };
const NAMES: MerchantCollection[] = ["customers", "subscriptions", "retentionSessions", "approvals"];

function toDataset(raw: Partial<Record<MerchantCollection, QueryDocumentSnapshot<DocumentData>[]>>): Dataset {
  return {
    customers: (raw.customers ?? []).map((d) => normalise.customer(d.id, d.data())),
    subscriptions: (raw.subscriptions ?? []).map((d) => normalise.subscription(d.id, d.data())),
    sessions: (raw.retentionSessions ?? []).map((d) => normalise.session(d.id, d.data())).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()),
    approvals: (raw.approvals ?? []).map((d) => normalise.approval(d.id, d.data())).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  };
}

export function WorkspaceProvider({ merchantId, children }: { merchantId: string; children: ReactNode }) {
  const [range, setRange] = useState<RangeKey>("30d");
  const [demo, setDemoState] = useState(false);
  const [raw, setRaw] = useState<Partial<Record<MerchantCollection, QueryDocumentSnapshot<DocumentData>[]>>>({});
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => { setDemoState(sessionStorage.getItem("retain.demo") === "1"); }, []);
  const setDemo = (on: boolean) => { setDemoState(on); sessionStorage.setItem("retain.demo", on ? "1" : "0"); };

  useEffect(() => {
    let cancelled = false; const stops: (() => void)[] = [];
    void getFirebaseServices().then(({ db }) => {
      if (cancelled) return;
      for (const name of NAMES) stops.push(listenToMerchantData(db, merchantId, name, (rows) => setRaw((prev) => ({ ...prev, [name]: rows })), (e) => setError(e.message.includes("permission") ? "Firestore denied access to workspace data. Check that the Security Rules are deployed." : "Live workspace data could not be loaded.")));
    }).catch(() => setError("Firebase could not be reached."));
    return () => { cancelled = true; stops.forEach((s) => s()); };
  }, [merchantId]);

  const loaded = NAMES.every((n) => raw[n]);
  const live = useMemo(() => toDataset(raw), [raw]);
  const demoData = useMemo(() => (demo ? makeDemoData(now) : EMPTY), [demo, now]);
  const value: Workspace = { merchantId, range, setRange, demo, setDemo, data: demo ? demoData : live, live, state: error ? "error" : loaded ? "ready" : "loading", error, now };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
