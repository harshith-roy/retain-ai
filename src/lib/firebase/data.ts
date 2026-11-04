import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

export type MerchantCollection = "customers" | "subscriptions" | "retentionSessions" | "approvals";

export function merchantCollection(db: Firestore, merchantId: string, name: MerchantCollection) {
  if (!merchantId || merchantId.includes("/")) throw new Error("Invalid merchant ID.");
  return collection(db, "merchants", merchantId, name);
}

// Financial and retention records are read-only from the browser. Future
// trusted Cloud Functions own mutations; the security rules deny client writes.
export function listenToMerchantData(
  db: Firestore,
  merchantId: string,
  name: MerchantCollection,
  onData: (rows: QueryDocumentSnapshot<DocumentData>[]) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    merchantCollection(db, merchantId, name),
    (snapshot) => onData(snapshot.docs),
    onError,
  );
}

export function listenToMerchant(
  db: Firestore,
  merchantId: string,
  onData: (data: DocumentData | undefined) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    doc(db, "merchants", merchantId),
    (snapshot) => onData(snapshot.data()),
    onError,
  );
}
