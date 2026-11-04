import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { authStore } from "@/lib/firebase/auth";
import { getJourney, importBrowserHistory } from "@/lib/records/records.functions";
import { EMPTY_JOURNEY, type JourneyView } from "@/lib/records/model";

/**
 * The DevPilot journey is stored in the merchant workspace by trusted server
 * functions. The browser only reads it; this hook refetches after actions.
 */
export type JourneyRecord = JourneyView;
export { EMPTY_JOURNEY };
const EVT = "retain-journey";
export const notifyJourneyChanged = () => window.dispatchEvent(new Event(EVT));
const legacyKey = (uid: string) => `retain.dev.${uid}.devpilotJourney`;

export function useJourney(uid: string | undefined) {
  const fetchJourney = useServerFn(getJourney);
  const importHistory = useServerFn(importBrowserHistory);
  const [j, setJ] = useState<JourneyRecord>(EMPTY_JOURNEY);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const u = authStore.getSnapshot().user; if (!u) return;
    try {
      const r = await fetchJourney({ data: { idToken: await u.getIdToken() } });
      if (r.ok) { setJ(r.journey); setState("ready"); setError(null); } else { setState("error"); setError(r.error); }
    } catch (e) { setState("error"); setError(e instanceof Error ? e.message : "Journey could not be loaded."); }
  }, [fetchJourney]);

  useEffect(() => {
    if (!uid) return;
    void (async () => {
      // One-time migration of the earlier browser-only history, labelled unverified.
      const raw = localStorage.getItem(legacyKey(uid));
      if (raw) {
        try {
          const old = JSON.parse(raw) as { audit?: { at: string; kind: string; detail: string }[] };
          const u = authStore.getSnapshot().user;
          if (u && old.audit?.length) {
            const r = await importHistory({ data: { idToken: await u.getIdToken(), entries: old.audit.slice(0, 100).map((a) => ({ at: a.at, kind: a.kind, detail: a.detail })) } });
            if (r.ok) localStorage.setItem(`${legacyKey(uid)}.imported`, raw);
            if (r.ok) localStorage.removeItem(legacyKey(uid));
          }
        } catch { /* keep the browser copy; retry next visit */ }
      }
      await load();
    })();
    const on = () => void load();
    window.addEventListener(EVT, on);
    const t = window.setInterval(on, 20000);
    return () => { window.removeEventListener(EVT, on); window.clearInterval(t); };
  }, [uid, load, importHistory]);

  return { journey: j, state, error, reload: load };
}
