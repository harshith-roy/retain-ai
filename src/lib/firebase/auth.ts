import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import type { Merchant } from "./merchants";
import { provisionWorkspace } from "@/lib/records/records.functions";
import { listenToMerchant } from "./data";
import { getFirebaseServices } from "./client";
import { firebaseProjectId, readFirebaseConfig, validateFirebaseConfig } from "./config";

export type AuthStatus =
  "loading" | "signed-out" | "provisioning" | "ready" | "error" | "unconfigured";
export interface AuthSnapshot {
  status: AuthStatus;
  user: User | null;
  merchant: Merchant | null;
  merchantId: string | null;
  role: string | null;
  error: string | null;
}
const initial: AuthSnapshot = {
  status: "loading",
  user: null,
  merchant: null,
  merchantId: null,
  role: null,
  error: null,
};
let state = initial;
let initialization: Promise<void> | undefined;
let stopMerchant: (() => void) | undefined;
let revision = 0;
const subscribers = new Set<() => void>();

function errorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

export function friendlyAuthError(error: unknown) {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : "";
  if (code === "auth/missing-initial-state" || /missing initial state/i.test(message)) {
    return "Google sign-in couldn’t finish because this browser blocked its temporary sign-in storage. Open the app in its own tab (not an embedded preview), allow cookies for this site, and try again.";
  }
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in was cancelled. You can try again whenever you’re ready.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google window. Allow pop-ups and try again.";
    case "auth/unauthorized-domain":
      return "This address isn’t authorized in Firebase. Add it to Authentication → Settings → Authorized domains.";
    case "auth/network-request-failed":
      return "We couldn’t reach Google. Check your connection and try again.";
    case "auth/redirect-cancelled-by-user":
      return "Sign-in was cancelled before it finished. Please try again.";
    case "auth/redirect-operation-pending":
      return "A sign-in is already in progress. Please wait a moment.";
    case "auth/web-storage-unsupported":
      return "This browser blocks the storage Google sign-in needs. Enable cookies and site data, then try again.";
    case "auth/operation-not-supported-in-this-environment":
      return "Google sign-in cannot open in this browser. Open the app in its own tab in a supported browser, allow pop-ups, and try again.";
    case "permission-denied":
      return "Workspace access was denied. Check that the RETAIN.AI Firestore rules are published for fir-4700f.";
    case "auth/operation-not-allowed":
      return "Google sign-in must be enabled in Firebase Authentication.";
    default:
      return message || "Something went wrong. Please try again.";
  }
}

// Diagnostic detail for live failures: which step failed, Firebase's error
// code, project and UID. None of these are secrets.
function diagnose(step: string, error: unknown, uid?: string) {
  const code =
    typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  const detail = `Step: ${step} · code: ${code} · project: ${firebaseProjectId}${uid ? ` · uid: ${uid}` : ""}`;
  console.error(`[RETAIN.AI workspace] ${detail}`, error);
  return `${friendlyAuthError(error)} (${detail})`;
}

function publish(next: AuthSnapshot) {
  state = next;
  subscribers.forEach((callback) => callback());
}

export const authStore = {
  subscribe(callback: () => void) {
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  },
  getSnapshot: () => state,
  getServerSnapshot: () => initial,
  initialize() {
    if (initialization) return initialization;
    const configError = validateFirebaseConfig(readFirebaseConfig());
    if (configError) {
      publish({ ...initial, status: "unconfigured", error: configError });
      initialization = Promise.resolve();
      return initialization;
    }
    initialization = new Promise<void>((resolve) => {
      getFirebaseServices()
        .then(async ({ auth, db }) => {
          // Complete any pending redirect sign-in before deciding workspace state.
          let redirectError: string | null = null;
          try {
            await getRedirectResult(auth);
          } catch (error) {
            redirectError = friendlyAuthError(error);
            console.error("[RETAIN.AI auth] redirect result", error);
          }
          onAuthStateChanged(
            auth,
            async (user) => {
              if (!user && redirectError) {
                publish({ ...initial, status: "signed-out", error: redirectError });
                redirectError = null;
                resolve();
                return;
              }
              const current = ++revision;
              stopMerchant?.();
              stopMerchant = undefined;
              if (!user) {
                publish({ ...initial, status: "signed-out" });
                resolve();
                return;
              }
              publish({ ...initial, status: "provisioning", user });
              try {
                // Server links an existing member, joins an invite, or creates a workspace.
                let membership: { merchantId: string; role: string };
                try {
                  const r = await provisionWorkspace({
                    data: { idToken: await user.getIdToken() },
                  });
                  if (!r.ok)
                    throw Object.assign(new Error(r.error), {
                      code: r.denied ? "retain/access-denied" : "retain/provisioning-failed",
                    });
                  membership = { merchantId: r.merchantId, role: r.role };
                } catch (error) {
                  if (current !== revision) return;
                  const denied = errorCode(error) === "retain/access-denied";
                  publish({
                    ...initial,
                    status: "error",
                    user,
                    error: denied
                      ? (error as Error).message
                      : diagnose("workspace access check", error, user.uid),
                  });
                  resolve();
                  return;
                }
                if (current !== revision) return;
                stopMerchant = listenToMerchant(
                  db,
                  membership.merchantId,
                  (data) => {
                    if (current !== revision) return;
                    if (!data) {
                      publish({
                        ...initial,
                        status: "error",
                        user,
                        error: "Your workspace could not be found.",
                      });
                    } else {
                      publish({
                        status: "ready",
                        user,
                        merchant: data as Merchant,
                        merchantId: membership.merchantId,
                        role: membership.role,
                        error: null,
                      });
                    }
                    resolve();
                  },
                  (error) => {
                    if (current !== revision) return;
                    publish({
                      ...initial,
                      status: "error",
                      user,
                      error: diagnose("read merchants/{uid}", error, user.uid),
                    });
                    resolve();
                  },
                );
              } catch (error) {
                if (current !== revision) return;
                publish({ ...initial, status: "error", user, error: friendlyAuthError(error) });
                resolve();
              }
            },
            (error) => {
              publish({ ...initial, status: "error", error: friendlyAuthError(error) });
              resolve();
            },
          );
        })
        .catch((error) => {
          publish({ ...initial, status: "error", error: friendlyAuthError(error) });
          resolve();
        });
    });
    return initialization;
  },
  async login() {
    const { auth } = await getFirebaseServices();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    // Do not redirect automatically on blocked pop-ups or unavailable storage:
    // that sends the same restricted browser into the missing-initial-state flow.
    // The caller displays friendlyAuthError and lets the user retry the popup.
    await signInWithPopup(auth, provider);
  },
  async logout() {
    const { auth } = await getFirebaseServices();
    await signOut(auth);
    ++revision;
    stopMerchant?.();
    stopMerchant = undefined;
    publish({ ...initial, status: "signed-out" });
  },
};
