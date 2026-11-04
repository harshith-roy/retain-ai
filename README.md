# RETAIN.AI

AI-powered subscription retention for SaaS merchants. When a customer tries to
cancel, RETAIN.AI collects the reason, generates a policy-compliant retention
offer with AI, routes risky offers to a human approver, and applies the
customer's choice to their PayPal subscription — with every financial outcome
re-read from PayPal before it is reported as verified.

Built for the PayPal AI Hackathon.

## Problem statement

Subscription businesses lose revenue to involuntary and voluntary churn, and
most cancellation flows are a single "Are you sure?" dialog. Merchants want to
save customers with relevant offers (pause, discount, downgrade, skip a cycle)
without giving an AI unrestricted power over real billing — and without
engineering a custom retention stack.

## Solution and key features

- **Guided cancellation portal** — collects the customer's reason and walks
  them through offers before cancelling.
- **AI retention offers** — Firecrawl scrapes the merchant's site for context,
  Groq generates an offer, and a server-side policy engine (`guardrails.ts`)
  caps discounts, strips false claims, and preserves the cancellation choice.
- **Human approval workflow** — offers above policy thresholds require an
  owner/approver decision in the Escalation Center, with Slack alerts and an
  Inngest escalation timeout. Nobody can approve an offer made to their own
  subscription.
- **PayPal Sandbox execution** — pause and cancel run against the PayPal
  Subscriptions API with consent checks, server-signed (HMAC) offers,
  idempotency claims, and a post-operation status re-read. Estimated revenue
  is always shown separately from PayPal-verified outcomes.
- **Merchant dashboard** — nine sections: Overview, Customers, Subscriptions,
  Sessions, Escalations, Revenue Analytics, Agent Studio, Integrations,
  Settings. Live Firestore listeners; labelled demo data when a workspace is
  empty.
- **Workspace isolation** — invitation-only onboarding; Firebase Auth +
  Firestore Security Rules keep every merchant's data inside their own
  workspace.
- **Notifications** — Slack approval alerts, Resend outcome emails (only after
  PayPal-verified results), ElevenLabs voice playback of offers, PostHog
  server-side analytics events.

## How the retention workflow works

1. A customer opens the cancellation portal and picks a reason.
2. The server verifies their Firebase sign-in, resolves their workspace, and
   enforces per-user/per-workspace hourly usage limits.
3. Firecrawl scrapes the merchant site; Groq drafts an offer; the policy
   engine enforces merchant-configured limits and signs compliant offers with
   an HMAC token.
4. If the offer exceeds policy, it goes to the Escalation Center: Slack alert,
   Inngest durable workflow with retries, and a 15-minute escalation timeout.
5. The customer accepts, declines, or continues cancelling. Declining never
   blocks cancellation.
6. On accept, the server checks ownership and consent, claims an idempotency
   record, calls PayPal (suspend/cancel), then **re-reads the subscription
   from PayPal** before marking the outcome verified.
7. The journey, offers, decisions, and verified outcomes persist to Firestore
   and appear on the dashboard; Resend emails and PostHog events fire only for
   verified outcomes.

## Technology stack and architecture

- **Frontend:** React 19, TanStack Start v1 (SSR, file-based routing,
  server functions), TanStack Query, Tailwind CSS v4, shadcn/ui, Recharts
- **Backend:** TanStack Start server functions + server routes
  (`/api/inngest`), running on a Cloudflare Workers-compatible runtime
- **Auth & database:** Firebase Authentication (Google) and Cloud Firestore
  with Security Rules; trusted server writes via a service account over the
  Firestore REST API
- **Payments:** PayPal Subscriptions API (Sandbox)
- **AI:** Firecrawl (scraping), Groq (offer generation)
- **Operations:** Slack, Resend, ElevenLabs, PostHog, Inngest

```text
Browser (React)                Server functions / routes              External
───────────────                ─────────────────────────              ─────────
Firebase Auth (Google)   ──▶   verify ID token                        Google
Firestore listeners      ◀──   resolve merchant from merchantUsers    Firestore
Dashboard / portal       ──▶   policy engine + HMAC-signed offers     Groq, Firecrawl
                               idempotency claim                      PayPal Sandbox
                               pause/cancel + PayPal status re-read   Slack, Resend,
                               best-effort notifications              ElevenLabs, PostHog
                               durable approval workflow              Inngest
```

## Screenshots

_Screenshots will be added before submission._

| Screen | Placeholder |
| --- | --- |
| Merchant dashboard — Overview | `docs/screenshots/dashboard-overview.png` |
| Cancellation portal with AI offer | `docs/screenshots/portal-offer.png` |
| Escalation Center approval | `docs/screenshots/escalations.png` |
| Revenue Analytics | `docs/screenshots/analytics.png` |

## Project structure

```text
src/
  routes/                     File-based routes (TanStack Start)
    index.tsx                 Landing page
    _authenticated.tsx        Client-only auth guard layout
    _authenticated.dashboard.* Merchant dashboard sections
    _authenticated.portal.devpilot.tsx  Demo cancellation portal
    api/inngest.ts            Inngest serve endpoint (signature-verified)
  lib/
    firebase/                 Client SDK, auth store, service-account REST writer
    security/                 Access rules (pure) + server guards/rate limits
    retention/                Firecrawl/Groq providers, policy guardrails, offers
    paypal/                   PayPal API client, authorization, journey logic
    records/                  Firestore persistence, approvals, invitations
    notify/                   Slack/Resend/PostHog/ElevenLabs + Inngest workflows
    dashboard/                Metrics model (pure), workspace provider, tables
  test/                       Vitest suites (unit, routing, rules emulator)
functions/                    Optional, undeployed Firebase Cloud Functions
firestore.rules               Published invitation-only security rules
firestore.rules.proposed      Review copy (currently identical to firestore.rules)
FIREBASE_SETUP.md             Firebase configuration and rules deployment guide
```

## Prerequisites

- Node.js 20+ (or Bun)
- A Firebase project with Google sign-in enabled and a Firestore database
- A PayPal Sandbox REST app and subscription plan
- Optional: Firecrawl, Groq, Slack, Resend, Inngest, ElevenLabs, PostHog keys
- Java 21+ (only for running the Firestore rules emulator tests)

## Local installation

```sh
git clone <repository-url>
cd retain-ai
npm install        # or: bun install
cp .env.example .env   # fill in values (see below)
npm run dev
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values. The file documents every
variable with placeholders only. Summary:

- `VITE_FIREBASE_*` — public Firebase web config (safe for the browser)
- `FIREBASE_SERVICE_ACCOUNT_JSON` — server-only service account for trusted
  Firestore writes (needs the Cloud Datastore User IAM role)
- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_PLAN_ID` — Sandbox app
- `FIRECRAWL_API_KEY`, `GROQ_API_KEY` — AI offer pipeline
- `RETAIN_SIGNING_SECRET` — HMAC secret signing AI offers
- `MERCHANT_SIGNUP_ALLOWLIST` — emails/domains allowed to create a workspace
- `SLACK_APPROVAL_CHANNEL`, `RESEND_FROM`, `INNGEST_SIGNING_KEY`,
  `ELEVENLABS_API_KEY`, `POSTHOG_API_KEY`, `POSTHOG_REGION` — notifications
- `LOVABLE_API_KEY` — Lovable connector gateway key (only when hosted on
  Lovable; see "Deployment" below)

## Firebase setup

Full guide: [FIREBASE_SETUP.md](./FIREBASE_SETUP.md). Short version:

1. Firebase Console → Project settings → Your apps → Web app → Config: copy
   the public web values into the `VITE_FIREBASE_*` variables.
2. Authentication → Sign-in method: enable **Google** with a support email.
3. Authentication → Settings → Authorized domains: add `localhost` and your
   hosting domains.
4. Create a service account with the **Cloud Datastore User** role and put its
   JSON key in `FIREBASE_SERVICE_ACCOUNT_JSON` (server only, never committed).
5. Set `MERCHANT_SIGNUP_ALLOWLIST` to the emails/domains allowed to create
   their own workspace; everyone else needs an invitation from a workspace
   owner (Settings → Team access).

### Firestore rules deployment

Rules are **not** deployed by the app. To publish them:

```sh
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules --project <your-project-id>
```

Or paste `firestore.rules` into Firestore Database → Rules → Publish. The
rules are deny-by-default: browsers can read their own workspace's dashboard
collections but can never write financial, retention, or membership records —
those go through authenticated server functions only.

## Integration setup

- **Firecrawl / Groq:** create API keys on each provider and set
  `FIRECRAWL_API_KEY` / `GROQ_API_KEY`. The AI offer form lives in Agent
  Studio and the portal.
- **PayPal Sandbox:** PayPal Developer → Apps & Credentials → create a Sandbox
  REST app; create a subscription plan and set its ID as `PAYPAL_PLAN_ID`.
- **Slack:** connect a Slack workspace and set `SLACK_APPROVAL_CHANNEL` to the
  channel that receives approval alerts and escalation notices.
- **Inngest:** set `INNGEST_SIGNING_KEY`; after deploying, sync the app in the
  Inngest dashboard with `https://<your-domain>/api/inngest`. The endpoint
  refuses to serve without the signing key.
- **Resend:** verify a sending domain and set `RESEND_FROM`. The Resend test
  sender only delivers to the Resend account owner.
- **ElevenLabs:** set `ELEVENLABS_API_KEY`; the portal shows a Listen button
  on offers.
- **PostHog:** set `POSTHOG_API_KEY` and `POSTHOG_REGION` (`us` or `eu`).

## Local development commands

```sh
npm run dev          # start the dev server
npm run test         # run the Vitest suite
npm run lint         # ESLint
npm run build        # production build
npm run preview      # preview the production build
```

Firestore rules emulator tests (require Java 21+):

```sh
bunx firebase emulators:exec --only firestore --project demo-retain-ai \
  "bunx vitest run src/test/firestore-rules.test.ts"
```

## Production build

```sh
npm run build
```

The build targets a Cloudflare Workers-compatible runtime via Nitro.

## Deployment

### Lovable (current hosting)

The app is built and hosted on Lovable; publishing from the Lovable editor
deploys the current code. Server secrets are managed as Lovable secrets.

### Vercel

> **Status: build-ready, not yet deployed.** `vite.config.ts` pins Nitro's
> `vercel` preset whenever `VERCEL` is set (Vercel sets it automatically).
> A local Vercel-mode build produced `.vercel/output` (Node.js 22 function);
> the home page returned 200 and `/api/inngest` rejected unsigned requests
> with 401. Lovable hosting keeps the Cloudflare-compatible target.

Steps:

1. Vercel → Add New Project → import this GitHub repository.
   Framework preset: **Other**. Build command: `npm run build` (default).
   Leave Output Directory empty (Nitro writes `.vercel/output`). Node 22.
2. Project → Settings → Environment Variables (Production + Preview):
   - Public (browser): `VITE_FIREBASE_API_KEY`, optionally the other
     `VITE_FIREBASE_*` values (defaults for `fir-4700f` are built in).
   - Server only (never `VITE_` prefix): `FIREBASE_SERVICE_ACCOUNT_JSON`,
     `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_PLAN_ID`,
     `FIRECRAWL_API_KEY`, `GROQ_API_KEY`, `RETAIN_SIGNING_SECRET`,
     `MERCHANT_SIGNUP_ALLOWLIST`, `SLACK_APPROVAL_CHANNEL`, `RESEND_FROM`,
     `INNGEST_SIGNING_KEY`, `ELEVENLABS_API_KEY`,
     `POSTHOG_API_KEY`, `POSTHOG_REGION`.
   - Firecrawl, Slack, Resend and Inngest event sending call the Lovable
     connector gateway and need `LOVABLE_API_KEY` plus `FIRECRAWL_API_KEY`,
     `SLACK_API_KEY`, `RESEND_API_KEY`, `INNGEST_API_KEY`. Lovable issues
     these inside its platform; outside Lovable they must be provided or the
     calls rewired to each provider's own API — **main blocker**. Groq,
     ElevenLabs, PostHog and PayPal call their providers directly.
3. Firebase Console → Authentication → Settings → Authorized domains: add the
   Vercel domain(s) (`<project>.vercel.app` and any custom domain). Sign-in
   is popup-based, so no extra OAuth redirect URI is needed beyond the
   authorized domain on `fir-4700f.firebaseapp.com`.
4. After deploying, sync `https://<vercel-domain>/api/inngest` in Inngest.
5. Firestore rules are environment-independent; nothing to redeploy.

## Security considerations

- **Deny-by-default Firestore rules.** Browsers read only their own
  workspace's dashboard collections; all writes to financial, retention,
  membership, settings, journey, and idempotency records are server-only.
- **Invitation-only onboarding.** Browsers cannot create workspaces or
  memberships; access is granted server-side via invitations or the
  `MERCHANT_SIGNUP_ALLOWLIST`.
- **Every server function verifies the Firebase ID token** and resolves the
  caller's workspace from `merchantUsers/{uid}` — a workspace ID sent from the
  browser is never trusted.
- **Approvals** require an owner/approver role and can never be decided by the
  session's own customer.
- **AI and voice endpoints** enforce per-user and per-workspace hourly rate
  limits, counted server-side.
- **PayPal mutations** require ownership, explicit consent, and a
  server-signed (HMAC) offer; every mutation claims an idempotency record and
  is re-read from PayPal before being reported as verified. Subscription
  details are returned only to the subscription's owner.
- **Secrets** (service account, PayPal, provider keys) are read only on the
  server; only the public Firebase web config reaches the browser.
- **AI output is untrusted:** all generated offers pass through a pure policy
  enforcer before reaching a customer, and scraped web content is treated as
  data, never instructions.

## Testing

```sh
npm run test
```

**Current status: 85/85 tests passing** (as of the latest run), including:

- Firestore Security Rules emulator tests (15) — workspace isolation,
  cross-merchant denial, invitation-only provisioning, read-only financial
  collections. These run against a local emulator and require Java 21+;
  without it they are skipped, not faked.
- Proposed-rules parity tests (4).
- Unit/integration tests for the policy guardrails, PayPal authorization and
  journey logic, subscription ownership privacy, approval roles, invitations,
  usage limits, dashboard metrics, and routing.

Not covered by automated tests: real Google OAuth sign-in, live PayPal buyer
approval, email delivery to inboxes. See "Known limitations".

## Known limitations and pending configuration

- **Real Google sign-in** has not been completed end-to-end in the browser
  (interactive test pending).
- **Resend delivery** sends without errors, but inbox arrival is unconfirmed;
  a verified sending domain (`RESEND_FROM`) is required for real recipients.
- **Inngest live runs** require publishing the app and syncing
  `/api/inngest` in the Inngest dashboard.
- **Slack approval + Inngest escalation** have not been exercised in a live
  journey (requires an offer that needs approval).
- **Vercel deployment** is untested (see Deployment).
- **Firebase Cloud Functions** in `functions/` are optional mirrors of server
  logic and are not deployed; the app does not depend on them.
- The service account uses the broad `cloud-platform` OAuth scope; moving to a
  least-privilege dedicated account and rotating the key is recommended.

## Future improvements

- Multi-member workspaces with granular roles beyond owner/approver
- Live PayPal (production) support after Sandbox sign-off
- Customer-facing portal theming per merchant
- Webhook-driven subscription sync from PayPal
- Deeper PostHog dashboards and churn analytics
- Deployed Cloud Functions for scheduled retention tasks

## Contributing

1. Fork the repository and create a feature branch from `main`.
2. Keep changes focused; run `npm run test` and `npm run build` before
   opening a pull request.
3. Never commit `.env`, service-account JSON, or any credentials — the
   `.gitignore` blocks them, but double-check `git status` before committing.
4. Do not weaken Firestore rules or server-side authorization checks in a PR
   without an explicit security discussion.
5. Keep documentation honest: mark unverified features as unverified.

## License

No license has been chosen yet. Until one is added, all rights are reserved by
the project owner.
