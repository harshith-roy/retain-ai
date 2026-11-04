import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { authStore } from "@/lib/firebase/auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    await authStore.initialize();
    if (authStore.getSnapshot().status !== "ready") throw redirect({ to: "/" });
  },
  pendingComponent: () => (
    <div className="grid min-h-screen place-items-center">
      <LoaderCircle
        className="size-6 animate-spin text-muted-foreground"
        aria-label="Opening workspace"
      />
    </div>
  ),
  component: () => <Outlet />,
});
