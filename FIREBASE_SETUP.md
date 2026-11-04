# RETAIN.AI Firebase foundation

## Actual connection status

The supplied auth domain, project ID, bucket, sender ID, and app ID are configured. `GOOGLE_API_KEY` and `GOOGLE_ANALYTICS_MEASUREMENT_ID` exist as server-only secrets. A secret reference is not a Firebase web configuration value and is not expanded by the browser. The saved key is not copied to source or exposed through a public endpoint. Supply the Firebase Console's public web `apiKey` as `VITE_FIREBASE_API_KEY` to enable the browser app. Analytics is optional and has not been enabled or changed.

The modular Firebase SDK, Google sign-in/sign-out, local authentication persistence, atomic merchant/profile creation, protected `/dashboard`, and reusable merchant-scoped listeners are implemented. Live authentication and Firestore reads/writes are not verified without the configuration and a real Google session. No Firestore rules, Cloud Functions, or hosted auth settings have been deployed or independently verified.

### Verification completed

All 17 local tests passed: 11 Firestore Emulator isolation tests and 6 configuration/routing tests, including the supplied web identifiers. A private diagnostic process successfully initialized Firebase App, Auth, and Firestore with the stored key without exposing it. A live Firebase Auth project-settings request succeeded: localhost and fir-4700f.firebaseapp.com are authorized, but this Lovable preview domain is not. Browser checks verified disabled sign-in while the public browser key is unavailable, `/dashboard` redirect, refresh behavior, and no runtime errors. The frontend build check passed. These checks do not verify live Google OAuth, persisted real-user authentication, deployed Security Rules, or production Firestore writes.

## 1. Provide the Firebase web configuration

Firebase Console → project **fir-4700f** → Project settings → General → Your apps → your Web app → SDK setup and configuration → Config.

Only the exact public web `apiKey` is still required by the browser. Copy it into `VITE_FIREBASE_API_KEY` as shown in `.env.example` (for local development, use `.env.local`), or provide the public Firebase web value for configuration. Do not supply an administrator/service-account key. The other supplied web identifiers are already configured. Redeploy/publish the frontend after changing published app settings. The optional `VITE_FIREBASE_MEASUREMENT_ID` is not required for authentication or Firestore; no analytics integration is being added.

## 2. Verify Google sign-in settings

Authentication → Sign-in method → Google must be enabled with the support email configured.

Live Firebase settings confirmed the preview domain is missing. Click Authentication → Settings → Authorized domains → Add domain, paste the preview hostname below (without https://), and click Add. Authorized domains must include:

- `localhost` for local testing (it is not automatically authorized for newer projects).
- `id-preview--5e3b5349-a94c-4d63-b5ed-be2637ac51f3.lovable.app` for this preview.
- Your actual published domain and any custom domain once available.

Use the exact `authDomain` Firebase provides; do not replace it with the app preview domain. Allow pop-ups for the app. Confirm the default Firestore database exists. A named, non-default database needs an explicit SDK change before use.

## 3. Review and deploy rules manually

**Warning:** These rules are a complete ruleset. Back up existing rules and reconcile any existing collections before replacing them. Existing broad allow rules elsewhere in a merged ruleset can defeat isolation; Firestore allow statements are additive.

Using Firebase CLI on your machine:

```sh
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules --project fir-4700f
```

Alternatively paste the reviewed `firestore.rules` into Firestore Database → Rules and select Publish. Verify the console shows the deployed rules and their publication timestamp. This app has **not** deployed them. Until reviewed rules are deployed, production isolation depends entirely on your existing rules.

### Data layout

- `merchants/{authUid}`: owner UID, workspace name, creation timestamp.
- `merchantUsers/{authUid}`: immutable merchant membership and owner role, Google display name/email/photo, creation timestamp.
- `merchants/{merchantId}/customers/{id}`
- `merchants/{merchantId}/subscriptions/{id}`
- `merchants/{merchantId}/retentionSessions/{id}`
- `merchants/{merchantId}/approvals/{id}`

First Google sign-in atomically creates one merchant and one owner profile; subsequent sign-ins reuse them. There is no multi-user invitation flow yet. Clients cannot change tenant IDs, owner IDs, or roles, enumerate other merchants, or write financial/retention records. Read listeners return an unsubscribe callback; callers must clean them up on unmount/sign-out. The active workspace listener is automatically cleaned up when authentication changes.

## 4. Test rules without production access

Java 21+ is required for the current Firestore Emulator. Tests use `demo-retain-ai`, not the real project.

```sh
bunx firebase emulators:exec --only firestore --project demo-retain-ai "bunx vitest run src/test/firestore-rules.test.ts"
bunx vitest run src/test/firebase-config.test.ts src/test/app-routing.test.tsx
```

The security suite exercises atomic creation, self reads, foreign-merchant denial, anonymous denial, membership/role immutability, scoped future collection reads, and client financial-write denial. Without `FIRESTORE_EMULATOR_HOST` the emulator suite is skipped, not represented as passing.

### Manual end-to-end acceptance

After supplying config and publishing rules: sign in with Google, confirm both Firestore documents exist, refresh `/dashboard`, confirm your same workspace, sign out, and visit `/dashboard` again to confirm it redirects to sign-in. Test with a second Google account to confirm separate merchant documents. Verify denial of foreign-tenant reads using emulator tests or the Rules Playground. A signed-out preview is not proof that this authenticated flow works.

## Compatibility and scope

Firebase browser services are initialized lazily after hydration. TanStack Start SSR never creates Firebase browser persistence or performs client-authenticated Firestore reads. The private dashboard uses a client-only route guard. Firestore rules, not that UI guard, enforce actual data access.

No Firebase Admin SDK or private credential is imported into the frontend. Future sensitive PayPal operations belong in separately deployed Firebase Cloud Functions with token verification, tenant checks, and secrets managed by Google Secret Manager. No Cloud Function was added or deployed in this authentication-only step; no PayPal integration is claimed operational.

No existing Firecrawl, Slack, ElevenLabs, Resend, Inngest, Groq, PostHog, or PayPal code was found during inspection. None was removed, changed, or newly claimed connected. Future financial integration remains centered on PayPal Sandbox.
## Persistent records (phase 5)
The app server writes workspace records with the `FIREBASE_SERVICE_ACCOUNT_JSON` server secret.
That service account needs the **Cloud Datastore User** role (Google Cloud Console → IAM → the account → Edit → Add role),
or use the key of the `firebase-adminsdk-…` account (Firebase Console → Project settings → Service accounts → Generate new private key).

Server-only paths (no Rules change needed; the existing catch-all denies browsers):
`merchants/{m}/journeys/*`, `merchants/{m}/settings/retention`, `merchants/{m}/idempotency/*`.
Dashboard-readable paths written by the server: `customers`, `subscriptions`, `retentionSessions`, `approvals`.

Optional Cloud Functions (`functions/`, Blaze plan required, not deployed):
`cd functions && npm install && npm run build && firebase deploy --only functions --project fir-4700f`
