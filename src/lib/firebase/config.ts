import type { FirebaseOptions } from "firebase/app";

export const firebaseProjectId = "fir-4700f";

export function validateFirebaseConfig(config: FirebaseOptions) {
  const missing = (["apiKey", "authDomain", "projectId", "appId"] as const).filter((key) => !config[key]);
  if (missing.length) return `Missing Firebase web settings: ${missing.join(", ")}.`;
  if (config.projectId !== firebaseProjectId) return `Firebase project must be ${firebaseProjectId}.`;
  return null;
}

export function readFirebaseConfig(): FirebaseOptions {
  return {
    apiKey: import.meta.env['VITE_FIREBASE_API_KEY'],
    authDomain: import.meta.env['VITE_FIREBASE_AUTH_DOMAIN'] || "fir-4700f.firebaseapp.com",
    projectId: import.meta.env['VITE_FIREBASE_PROJECT_ID'] || firebaseProjectId,
    appId: import.meta.env['VITE_FIREBASE_APP_ID'] || "1:285826170923:web:50b5db9f7ce12a2dc52a6e",
    storageBucket: import.meta.env['VITE_FIREBASE_STORAGE_BUCKET'] || "fir-4700f.firebasestorage.app",
    messagingSenderId: import.meta.env['VITE_FIREBASE_MESSAGING_SENDER_ID'] || "285826170923",
    measurementId: import.meta.env['VITE_FIREBASE_MEASUREMENT_ID'],
  };
}