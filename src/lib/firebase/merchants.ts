import type { User } from "firebase/auth";
import { doc, runTransaction, serverTimestamp, type Firestore, type Timestamp } from "firebase/firestore";

export interface Merchant {
  ownerUid: string;
  name: string;
  createdAt: Timestamp | null;
}

export interface MerchantUser {
  uid: string;
  merchantId: string;
  role: "owner" | "approver";
  displayName: string;
  email: string;
  photoURL: string;
  createdAt: Timestamp | null;
}

// A merchant's first owner has a stable tenant ID equal to their Auth UID.
// Provision both records atomically; rules verify the paired getAfter records.
export async function ensureMerchantProfile(db: Firestore, user: User) {
  const merchantRef = doc(db, "merchants", user.uid);
  const userRef = doc(db, "merchantUsers", user.uid);
  await runTransaction(db, async (transaction) => {
    const merchant = await transaction.get(merchantRef);
    const profile = await transaction.get(userRef);
    if (merchant.exists() && profile.exists()) return;
    if (merchant.exists() || profile.exists()) throw new Error("Your workspace records need administrator attention. No changes were made.");
    transaction.set(merchantRef, {
      ownerUid: user.uid,
      name: user.displayName ? `${user.displayName}'s workspace` : "My workspace",
      createdAt: serverTimestamp(),
    });
    transaction.set(userRef, {
      uid: user.uid,
      merchantId: user.uid,
      role: "owner",
      displayName: user.displayName ?? "Merchant",
      email: user.email ?? "",
      photoURL: user.photoURL ?? "",
      createdAt: serverTimestamp(),
    });
  });
}