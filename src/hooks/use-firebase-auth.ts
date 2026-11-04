import { useSyncExternalStore } from "react";
import { authStore } from "@/lib/firebase/auth";

export function useFirebaseAuth() {
  return useSyncExternalStore(
    authStore.subscribe,
    authStore.getSnapshot,
    authStore.getServerSnapshot,
  );
}
