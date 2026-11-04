import { getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { readFirebaseConfig, validateFirebaseConfig } from "./config";

export async function getFirebaseServices() {
  const config = readFirebaseConfig();
  const error = validateFirebaseConfig(config);
  if (error) throw new Error(error);
  const app = getApps().find((entry) => entry.name === "retain") ?? initializeApp(config, "retain");
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  return { app, auth, db: getFirestore(app) };
}