import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Bot,
  Building2,
  CircleAlert,
  CreditCard,
  FlaskConical,
  LayoutDashboard,
  LifeBuoy,
  LineChart,
  LogOut,
  MessagesSquare,
  Plug,
  Settings,
  Users,
} from "lucide-react";
import { Orbit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useFirebaseAuth } from "@/hooks/use-firebase-auth";
import { authStore, friendlyAuthError } from "@/lib/firebase/auth";
import { WorkspaceProvider, useWorkspace } from "@/lib/dashboard/workspace";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Merchant dashboard · RETAIN.AI" },
      {
        name: "description",
        content:
          "Your private RETAIN.AI merchant workspace for retention sessions and revenue recovery.",
      },
      { property: "og:title", content: "RETAIN.AI · Merchant dashboard" },
      { property: "og:description", content: "Your private merchant workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardLayout,
});

const NAV = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/dashboard/agent-studio", label: "AI Agent Studio", icon: Bot },
  { to: "/dashboard/customers", label: "Customers", icon: Users },
  { to: "/dashboard/subscriptions", label: "Subscriptions", icon: CreditCard },
  { to: "/dashboard/sessions", label: "Retention Sessions", icon: MessagesSquare },
  { to: "/dashboard/escalations", label: "Escalation Center", icon: LifeBuoy },
  { to: "/dashboard/analytics", label: "Revenue Analytics", icon: LineChart },
  { to: "/dashboard/integrations", label: "Integrations", icon: Plug },
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

function DashboardLayout() {
  const auth = useFirebaseAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (auth.status !== "ready") void navigate({ to: "/", replace: true });
  }, [auth.status, navigate]);
  // Never render cached private workspace content after the session changes.
  if (auth.status !== "ready" || !auth.user || !auth.merchant || !auth.merchantId) return null;
  return (
    <div className="console min-h-screen">
      <WorkspaceProvider merchantId={auth.merchantId}>
        <SidebarProvider>
          <div className="flex min-h-screen w-full">
            <AppSidebar />
            <SidebarInset className="bg-background">
              <TopBar />
              <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-8">
                <Outlet />
              </main>
            </SidebarInset>
          </div>
        </SidebarProvider>
      </WorkspaceProvider>
    </div>
  );
}

function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname.replace(/\/$/, "") });
  const { data } = useWorkspace();
  const pending = data.approvals.filter((a) => a.status === "pending").length;
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <Orbit className="size-4" />
          </span>
          <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
            RETAIN<span className="text-muted-foreground">.AI</span>
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild isActive={path === item.to} tooltip={item.label}>
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.to === "/dashboard/escalations" && pending > 0 && (
                    <SidebarMenuBadge className="text-warning">{pending}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Account />
      </SidebarFooter>
    </Sidebar>
  );
}

function Account() {
  const auth = useFirebaseAuth();
  const navigate = useNavigate();
  const { queryClient } = Route.useRouteContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      sessionStorage.removeItem("retain.demo");
      await authStore.logout();
      await navigate({ to: "/", replace: true });
    } catch (issue) {
      setError(friendlyAuthError(issue));
    } finally {
      setBusy(false);
    }
  }
  const name = auth.user?.displayName || "Merchant";
  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="flex gap-1.5 text-xs text-destructive">
          <CircleAlert className="size-3.5" />
          {error}
        </p>
      )}
      <div className="flex items-center gap-2.5 rounded-lg p-1.5 group-data-[collapsible=icon]:p-0">
        <Avatar className="size-8 rounded-md">
          <AvatarImage src={auth.user?.photoURL ?? undefined} alt="" />
          <AvatarFallback className="rounded-md bg-accent text-xs">
            {name.slice(0, 1)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{auth.user?.email}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 group-data-[collapsible=icon]:hidden"
          onClick={logout}
          disabled={busy}
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut />
        </Button>
      </div>
    </div>
  );
}

function TopBar() {
  const auth = useFirebaseAuth();
  const { demo, setDemo } = useWorkspace();
  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
        <SidebarTrigger />
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Building2 className="size-4 shrink-0" />
          <span className="truncate">{auth.merchant?.name}</span>
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <FlaskConical className="size-3.5" />
          <span className="hidden sm:inline">Demo data</span>
          <Switch checked={demo} onCheckedChange={setDemo} aria-label="Show demonstration data" />
        </label>
      </header>
      {demo && (
        <div className="border-b border-warning/20 bg-warning/10 px-4 py-2 text-center text-xs text-warning md:px-6">
          You are viewing demonstration data. These are not real customers, sessions or revenue, and
          nothing here was processed by PayPal.
        </div>
      )}
    </>
  );
}
