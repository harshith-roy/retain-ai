import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Check, CircleAlert, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/brand";
import { authStore, friendlyAuthError } from "@/lib/firebase/auth";
import { useFirebaseAuth } from "@/hooks/use-firebase-auth";
import loopImage from "@/assets/retention-loop.jpg";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Sign in · RETAIN.AI" },
    { name: "description", content: "Sign in to your RETAIN.AI merchant workspace with Google." },
    { property: "og:title", content: "RETAIN.AI · Merchant workspace" },
    { property: "og:description", content: "Your secure merchant retention workspace." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Index,
});

function Index() {
  const auth = useFirebaseAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  useEffect(() => { if (auth.status === "ready") void navigate({ to: "/dashboard", replace: true }); }, [auth.status, navigate]);
  const loading = busy || ["loading", "provisioning", "ready"].includes(auth.status);
  async function login() {
    setError(null); setBusy(true);
    try { await authStore.login(); } catch (issue) { setError(friendlyAuthError(issue)); } finally { setBusy(false); }
  }
  async function logout() {
    try { await authStore.logout(); } catch (issue) { setError(friendlyAuthError(issue)); }
  }
  return <main className="auth-page min-h-screen bg-background">
    <header className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-6 py-7 lg:px-14">
      <Brand /><span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className="size-1.5 rounded-full bg-primary" /> MERCHANT WORKSPACE</span>
    </header>
    <div className="mx-auto grid max-w-[1440px] lg:min-h-[700px] lg:grid-cols-2">
      <section className="flex flex-col justify-center px-6 py-12 lg:px-14 lg:py-16">
        <div className="mb-9 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground"><span className="h-px w-7 bg-primary" /> A better way to stay</div>
        <h1 className="text-5xl font-semibold leading-[1.1] md:text-6xl">Welcome back.<br /><span className="text-muted-foreground">Keep the connection.</span></h1>
        <p className="mt-6 max-w-sm text-base leading-7 text-muted-foreground">Sign in to your merchant workspace.<br />Your next chapter starts with the customers you have.</p>
        <div className="mt-10 w-full max-w-sm">
          <Button className="h-14 w-full justify-between rounded-md px-5 text-sm" disabled={loading || auth.status === "unconfigured"} onClick={login}>
            <span className="flex items-center gap-3">{loading ? <LoaderCircle className="animate-spin" /> : <span className="google-letter" aria-hidden="true">G</span>}{auth.status === "provisioning" ? "Opening your workspace…" : loading ? "Checking your session…" : "Continue with Google"}</span><ArrowRight />
          </Button>
          <p className="mt-4 text-center text-xs text-muted-foreground">New here? Your workspace is created when you sign in.</p>
          {(error || (auth.error && auth.status !== "unconfigured")) && <div role="alert" className="mt-5 flex gap-3 border-l-2 border-destructive bg-destructive/5 p-4 text-sm leading-6"><CircleAlert className="mt-1 size-4 shrink-0 text-destructive" /><div>{error || auth.error}{auth.user && <Button variant="link" className="mt-2 block px-0" onClick={logout}>Sign out and try again</Button>}</div></div>}
          {auth.status === "unconfigured" && <div className="mt-6 border-t pt-5">
            <div className="flex items-center gap-2 text-sm font-medium"><CircleAlert className="size-4 text-muted-foreground" /> Firebase connection pending</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">The web app settings for fir-4700f are missing. Sign-in will be available once they’re connected.</p>
            <Button variant="link" className="mt-1 h-8 px-0 text-xs" onClick={() => setDetails(!details)}>{details ? "Hide required settings" : "View required settings"}<ArrowRight className="size-3" /></Button>
            {details && <div className="mt-2 bg-muted p-4 text-xs leading-6 text-muted-foreground">Firebase Console → Project settings → General → Your apps → Web app.<br /><strong className="text-foreground">Provide apiKey, authDomain, and appId.</strong><br />Project ID: fir-4700f. Include storageBucket and messagingSenderId if shown. These are public web settings, not an administrator key.</div>}
          </div>}
          <div className="mt-9 flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="size-3.5" /> Secured with Google authentication</div>
        </div>
      </section>
      <section className="loop-panel relative mx-6 mb-8 flex min-h-[450px] flex-col overflow-hidden rounded-lg lg:mx-6 lg:mb-6 lg:mr-10">
        <div className="absolute left-7 top-7 z-10 flex items-center gap-2 text-xs font-medium"><span className="size-2 rounded-full bg-primary" /> Built for lasting relationships</div>
        <img src={loopImage} alt="A continuous glass and lime loop" width={1024} height={1024} className="absolute inset-0 h-full w-full object-cover" />
        <div className="relative z-10 mt-auto px-7 pb-8 pt-80 md:px-9 lg:pt-[510px]">
          <p className="max-w-sm text-3xl font-medium leading-tight">Great businesses<br />come full circle.</p>
          <div className="mt-7 flex flex-wrap gap-4 text-xs"><span className="flex items-center gap-1.5"><Check className="size-3.5" /> Customer-first</span><span className="flex items-center gap-1.5"><Check className="size-3.5" /> Merchant-owned</span></div>
        </div>
      </section>
    </div>
    <footer className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-6 py-7 text-xs text-muted-foreground lg:px-14"><span>© 2026 RETAIN.AI</span><span className="flex items-center gap-2"><ShieldCheck className="size-3.5" /> Your workspace. Your data.</span></footer>
  </main>;
}
