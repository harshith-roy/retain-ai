/**
 * Optional Firebase Cloud Functions for RETAIN.AI (NOT deployed).
 * Mirrors the app-server approval and settings logic so it can move to
 * Firebase later. Requires the Blaze plan. Deploy manually:
 *   cd functions && npm install && npm run build
 *   firebase deploy --only functions --project fir-4700f
 * The app currently uses its own server functions; switch the Escalation
 * Center to httpsCallable("decideApproval") only after deployment is verified.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();
const db = getFirestore();

async function ownerMerchant(uid: string | undefined) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const m = (await db.doc(`merchantUsers/${uid}`).get()).data();
  if (!m || m["uid"] !== uid || typeof m["merchantId"] !== "string")
    throw new HttpsError("permission-denied", "No workspace.");
  if (m["role"] !== "owner") throw new HttpsError("permission-denied", "Owner only.");
  return m["merchantId"] as string;
}

export const decideApproval = onCall({ region: "us-central1" }, async (req) => {
  const merchantId = await ownerMerchant(req.auth?.uid);
  const { approvalId, outcome } = (req.data ?? {}) as { approvalId?: string; outcome?: string };
  if (
    !approvalId ||
    !/^[0-9a-f-]{36}$/i.test(approvalId) ||
    (outcome !== "approved" && outcome !== "rejected")
  )
    throw new HttpsError("invalid-argument", "Bad request.");
  return db.runTransaction(async (tx) => {
    const aRef = db.doc(`merchants/${merchantId}/approvals/${approvalId}`);
    const sRef = db.doc(`merchants/${merchantId}/retentionSessions/${approvalId}`);
    const [a, s] = await Promise.all([tx.get(aRef), tx.get(sRef)]);
    if (!a.exists || !s.exists) throw new HttpsError("not-found", "Approval not found.");
    if (a.get("status") !== "pending") return { duplicate: true, outcome: a.get("status") };
    const d = s.get("decision") as { status: string; offer: unknown };
    const decision =
      outcome === "approved"
        ? { ...d, status: "offer" }
        : { ...d, status: "no_offer", offer: null };
    // NOTE: the decision signature (RETAIN_SIGNING_SECRET) must be re-issued by the
    // app server, which owns that secret; set it as a Functions secret before use.
    tx.update(aRef, {
      status: outcome,
      decidedBy: req.auth!.uid,
      decidedAt: FieldValue.serverTimestamp(),
    });
    tx.update(sRef, { decision, approval: outcome, status: "active" });
    return { duplicate: false, outcome };
  });
});
