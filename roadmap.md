<!-- Current scope: Firebase Google authentication; historical blockers below are unchanged. -->
# Firebase Google authentication correction
- [x] Inspect popup/redirect behavior; stop automatic redirect fallback in storage-restricted browsers without changing access checks or Firebase records
- [x] 32 authentication/configuration/access/routing tests passed; production build OK; real Google popup opened and cancellation/refresh/signed-out protection checked without signing in or writing Firebase records
- [ ] Real Google account session restoration requires user sign-in; published domain picture-perfect-pattern.lovable.app is absent from the live Firebase authorized-domain list and must be added manually

# PayPal checkout correction
- [x] Offer existing PayPal checkout for no subscription or confirmed cancelled/expired subscriptions; preserve active/paused management
- [x] Checkout eligibility and PayPal regressions passed (24 tests); full local suite passed (93 tests, none skipped); preview production build OK; no live subscription actions run

# Firebase foundation
- [x] Modular SDK and persistent Google authentication implementation
- [x] Merchant profiles, isolated collections, and real-time services
- [x] Protected dashboard and polished authentication states
- [x] Security Rules and manual configuration guide
- [x] 17 tests passed; browser checked pending setup, refresh, route protection, and mobile layout
- [x] Configure supplied public Firebase web app identifiers; confirm saved key availability without exposing it
- [x] Verify SDK diagnostic initialization and live Firebase authorized-domain settings
- [ ] Connect and verify live authentication — requires a public Firebase web apiKey rather than a server-only secret reference, then interactive Google sign-in
- [x] Authorize preview hostname — live Firebase settings confirm preview hostname, localhost, and Firebase auth domain are authorized
- [ ] Verify production merchant isolation — blocked by manual Security Rules review/deployment to fir-4700f
# Phase 2 — Merchant dashboard foundation
- [x] Midnight console theme, sidebar with 9 sections, merchant profile and sign-out
- [x] Overview: 6 KPIs, performance chart, funnel, activity, approvals, subscription mix, date range
- [x] Customers / Subscriptions / Sessions / Escalations tables with search, filter, paging
- [x] Revenue Analytics separates estimated revenue from verified PayPal outcomes
- [x] Agent Studio draft form (browser-only, authorizes nothing)
- [x] Honest Integrations status page
- [ ] Live Firestore data — blocked on rules deployment and real sign-in test
- [ ] Approve/reject actions and Agent Studio persistence — need verified Cloud Functions
# Phase 5 — Persistent journey records
- [x] Trusted server writer (service account) + merchant resolution from membership
- [x] Persist sessions, offers, policy checks, approvals, choices, PayPal results, activity, settings
- [x] Idempotent actions; dashboard + portal + Agent Studio read saved records; browser history migration
- [x] Escalation Center approve/reject; optional Cloud Functions code (not deployed)
- [ ] Live write verification — blocked: service account lacks Firestore permission (grant Cloud Datastore User)
# Phase 6 — Hackathon integrations
- [x] Slack approval alerts + decision notices + escalation (Escalation Center link)
- [x] Inngest durable workflow: retried alerts, 15-min escalation timeout (/api/inngest)
- [x] Listen button on portal offers (local Kokoro TTS)
- [x] Resend outcome emails after PayPal-verified pause/cancel
- [x] PostHog server events for offers, decisions, approvals, verified outcomes
- [ ] Firestore saving — blocked: service account still gets 403 (grant Cloud Datastore User)
- [ ] Inngest live runs — needs publish, then sync https://<published-url>/api/inngest in Inngest
- [ ] Resend to real customers — needs a verified sending domain (set RESEND_FROM)
# Phase 7 — Live DevPilot journey (Nov 2)
- [x] Reason → AI offer → decline → new offer → accept pause (PayPal SUSPENDED) → cancel (PayPal CANCELLED), saved and shown on dashboard
- [x] Fixed: offer signature broke after saving; Reset demo disconnected subscription; offer lost on refresh; no cancel for paused subs
- [ ] Slack approval + Inngest escalation in a live journey — needs an offer that requires approval, plus publish + Inngest sync
- [ ] Confirm Resend emails arrived in the inbox (test sender delivers only to the Resend account owner)
