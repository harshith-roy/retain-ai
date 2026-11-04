import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { name: "existing-auth" },
  db: { name: "existing-db" },
  popup: vi.fn(), redirect: vi.fn(), redirectResult: vi.fn(),
  observe: vi.fn(), signOut: vi.fn(), services: vi.fn(),
  provision: vi.fn(), listen: vi.fn(), parameters: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class { setCustomParameters = mocks.parameters; },
  signInWithPopup: mocks.popup,
  signInWithRedirect: mocks.redirect,
  getRedirectResult: mocks.redirectResult,
  onAuthStateChanged: mocks.observe,
  signOut: mocks.signOut,
}));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseServices: mocks.services }));
vi.mock("@/lib/firebase/config", () => ({
  firebaseProjectId: "fir-4700f",
  readFirebaseConfig: () => ({ projectId: "fir-4700f" }),
  validateFirebaseConfig: () => null,
}));
vi.mock("@/lib/records/records.functions", () => ({ provisionWorkspace: mocks.provision }));
vi.mock("@/lib/firebase/data", () => ({ listenToMerchant: mocks.listen }));

const user = { uid: "existing-owner", getIdToken: async () => "test-token" };
const merchant = { ownerUid: user.uid, name: "Existing workspace" };

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.services.mockResolvedValue({ auth: mocks.auth, db: mocks.db });
  mocks.redirectResult.mockResolvedValue(null);
  mocks.popup.mockResolvedValue({ user });
  mocks.signOut.mockResolvedValue(undefined);
  mocks.observe.mockImplementation((_auth, callback) => { void callback(null); return vi.fn(); });
  mocks.provision.mockResolvedValue({ ok: true, merchantId: "workspace-1", role: "owner" });
  mocks.listen.mockImplementation((_db, _id, callback) => { callback(merchant); return vi.fn(); });
});

describe("Firebase Google authentication", () => {
  it("uses the existing auth and Google account selector with popup-only login", async () => {
    const { authStore } = await import("@/lib/firebase/auth");
    await authStore.initialize();
    await authStore.login();
    expect(mocks.parameters).toHaveBeenCalledWith({ prompt: "select_account" });
    expect(mocks.popup).toHaveBeenCalledWith(mocks.auth, expect.any(Object));
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(authStore.getSnapshot().status).toBe("signed-out");
  });

  it.each(["auth/popup-blocked", "auth/web-storage-unsupported", "auth/operation-not-supported-in-this-environment", "auth/popup-closed-by-user", "auth/cancelled-popup-request"])(
    "surfaces %s without starting redirect authentication", async (code) => {
      const error = Object.assign(new Error(code), { code });
      mocks.popup.mockRejectedValue(error);
      const { authStore } = await import("@/lib/firebase/auth");
      await expect(authStore.login()).rejects.toBe(error);
      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(mocks.provision).not.toHaveBeenCalled();
    },
  );

  it("waits for a pending legacy redirect before restoring a session and checking membership", async () => {
    let finishRedirect: (() => void) | undefined;
    mocks.redirectResult.mockReturnValue(new Promise<void>((resolve) => { finishRedirect = resolve; }));
    mocks.observe.mockImplementation((_auth, callback) => { void callback(user); return vi.fn(); });
    const { authStore } = await import("@/lib/firebase/auth");
    const initialized = authStore.initialize();
    await vi.waitFor(() => expect(mocks.redirectResult).toHaveBeenCalledWith(mocks.auth));
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
    if (!finishRedirect) throw new Error("Redirect callback missing");
    finishRedirect();
    await initialized;
    expect(mocks.provision).toHaveBeenCalledWith({ data: { idToken: "test-token" } });
    expect(authStore.getSnapshot()).toMatchObject({ status: "ready", merchantId: "workspace-1", role: "owner", user });
  });

  it("accepts a missing redirect result and remains signed out without creating records", async () => {
    const { authStore } = await import("@/lib/firebase/auth");
    await authStore.initialize();
    expect(authStore.getSnapshot()).toMatchObject({ status: "signed-out", error: null });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("restores the persisted session after a legacy redirect error without clearing authentication", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.redirectResult.mockRejectedValue(Object.assign(new Error("missing initial state"), { code: "auth/missing-initial-state" }));
    mocks.observe.mockImplementation((_auth, callback) => { void callback(user); return vi.fn(); });
    const { authStore } = await import("@/lib/firebase/auth");
    await authStore.initialize();
    expect(authStore.getSnapshot().status).toBe("ready");
    expect(mocks.signOut).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("does not open a workspace when the authenticated account is not invited", async () => {
    mocks.observe.mockImplementation((_auth, callback) => { void callback(user); return vi.fn(); });
    mocks.provision.mockResolvedValue({ ok: false, denied: true, error: "Invitation required." });
    const { authStore } = await import("@/lib/firebase/auth");
    await authStore.initialize();
    expect(authStore.getSnapshot()).toMatchObject({ status: "error", merchant: null, merchantId: null });
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it("initializes once and signs out the existing auth instance", async () => {
    mocks.observe.mockImplementation((_auth, callback) => { void callback(user); return vi.fn(); });
    const { authStore } = await import("@/lib/firebase/auth");
    await Promise.all([authStore.initialize(), authStore.initialize()]);
    expect(mocks.observe).toHaveBeenCalledTimes(1);
    await authStore.logout();
    expect(mocks.signOut).toHaveBeenCalledWith(mocks.auth);
    expect(authStore.getSnapshot()).toMatchObject({ status: "signed-out", user: null, merchant: null });
  });
});