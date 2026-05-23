# Wix HubSpot Sync

A self-hosted Wix app that connects a Wix site to HubSpot and keeps contacts in sync both ways. Wix form submissions are pushed into HubSpot with marketing attribution. A small dashboard lets the site owner connect or disconnect HubSpot, decide which fields flow between the two systems, and watch every sync event as it happens.

## All the URLs

**For the reviewer:**

| Purpose | URL |
|---|---|
| Wix install link (start here) | https://www.wix.com/app-market/test/e4e4d653-2748-42ec-bd6e-8c6f042c18e2 |
| Dashboard (loads inside Wix after install) | https://wix-hubspot-sync.netlify.app |
| GitHub repository | https://github.com/Beliya470/wix-hubspot-sync |

**Infrastructure:**

| Piece | URL |
|---|---|
| Backend API + OAuth callbacks | https://wix-hubspot-sync-backend.onrender.com |
| Backend health check | https://wix-hubspot-sync-backend.onrender.com/health |
| HubSpot webhook endpoint | https://wix-hubspot-sync-backend.onrender.com/webhooks/hubspot |
| Wix webhook endpoint | https://wix-hubspot-sync-backend.onrender.com/webhooks/wix |
| HubSpot OAuth callback | https://wix-hubspot-sync-backend.onrender.com/auth/hubspot/callback |
| Wix OAuth install handshake | https://wix-hubspot-sync-backend.onrender.com/api/wix/install |
| Database | Neon Postgres (managed) |

**Admin URLs you'll need during testing:**

| Where | URL |
|---|---|
| HubSpot account (EU portal) | https://app-eu1.hubspot.com |
| HubSpot developer apps | https://developers.hubspot.com |
| Wix developer apps | https://dev.wix.com/apps |
| Wix site dashboard | https://manage.wix.com |

The backend runs on Render's free tier, so the first request after a quiet period takes about 50 seconds to wake the instance. Subsequent requests are fast.

## How a reviewer installs and tests the app

The app is registered as a self-hosted Wix app (App ID `58ed4665-013d-4023-8e71-41c15fecd85c`) and published as a v1.0 draft. Anyone can install it on a Wix site they own using the share install link.

**Wix share install link:** https://www.wix.com/app-market/test/e4e4d653-2748-42ec-bd6e-8c6f042c18e2

Steps:

1. Sign into your Wix account at https://manage.wix.com (or create a free one).
2. Open the share install link above. Click Install and pick the Wix site to install it on.
3. Wix shows the consent screen for the requested permissions (Read Contacts (PII), Manage Contacts). Click Add to Site.
4. After install, Wix opens your site's dashboard with the HubSpot Sync app added as a page in the sidebar.
5. Click HubSpot Sync in the Wix dashboard sidebar. The app's interface loads inside Wix's UI.
6. Click Connect HubSpot. You will be sent to HubSpot's consent screen (this leaves the Wix iframe because HubSpot blocks iframe embedding). Sign in to your own HubSpot account (or create a free one), grant the 5 requested scopes, click Connect app.
7. After HubSpot consent you land back on the dashboard at https://wix-hubspot-sync.netlify.app/, this time with both Wix and HubSpot connected.

You can now exercise every assignment requirement against your own Wix and HubSpot data.

## Acceptance criteria walkthrough

Each row maps an assignment requirement to where it is implemented and how to demo it.

| Requirement | Where in code | How to demo |
|---|---|---|
| OAuth 2.0 to HubSpot, no API keys in browser | `backend/src/routes/auth.ts`, `backend/src/services/tokenService.ts` | Connect HubSpot from the dashboard. Tokens are exchanged server-side and never touch the browser. |
| Tokens encrypted at rest with rotation | `backend/src/crypto.ts`, `backend/src/repositories/tokens.ts` | Inspect the `hubspot_tokens` table. Access and refresh tokens are stored as AES-256-GCM ciphertext with IV and auth tag in separate columns. Refresh runs automatically 60 seconds before expiry. |
| Least privilege scopes | `HUBSPOT_SCOPES` env var | Five scopes only: `oauth`, `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.read`, `crm.schemas.contacts.write`. |
| Safe logging (no PII or tokens) | `backend/src/logger.ts` | pino redaction strips `authorization`, `cookie`, `email`, `phone`, `firstname`, `lastname`, all token field names. |
| User can connect / disconnect from the dashboard | `frontend/src/components/ConnectionPanel.tsx`, `backend/src/routes/auth.ts` | The Connection card has a Connect HubSpot button and a Disconnect button once linked. Disconnect revokes the HubSpot refresh token and deletes the encrypted record. |
| Field mapping table UI | `frontend/src/components/MappingTable.tsx`, `backend/src/routes/mappings.ts` | Add rows to the mapping table picking Wix field, HubSpot property, direction, and transform. Save persists to `field_mappings` and reloads correctly. |
| Duplicate validation | `MappingTable.tsx` `validateRows`, `routes/mappings.ts` `putBody` | Client and server both reject a Wix field mapped twice. Same HubSpot property is allowed twice only when the two rows map opposite directions. |
| Bi-directional contact sync (create + update) | `backend/src/services/syncEngine.ts` | Create or edit a contact in Wix CRM. Within seconds it appears in HubSpot. Edit the same contact in HubSpot. Within seconds the change flows back to Wix. |
| ID mapping Wix ↔ HubSpot | `backend/src/repositories/contactMap.ts`, migration `1700000000004_create-contact-id-map.js` | One-to-one unique constraints in both directions. Engine consults this table before every write. |
| Loop prevention (origin tag + dedupe window) | `backend/src/services/loopPrevention.ts` and `sync_log` table | Edit a contact in Wix. The engine writes to HubSpot, logs `wix_to_hubspot` success. HubSpot then fires `contact.propertyChange`. Within the 30-second dedupe window the engine recognises this as the echo of its own write and logs `Skipped, mirrored a change we just made`. |
| Idempotency check | `syncEngine.ts` `valuesIdentical` | Submit the same lead twice with identical fields. The second run reports `Skipped, no field values changed` because the mapped property set is byte-equal. |
| Conflict resolution (last-updated-wins) | `syncEngine.ts` `resolveConflict` | Both records carry an `updatedAt`. If the target is strictly newer, the engine skips with reason `the destination already has newer data`. |
| Form submission to HubSpot with UTM | `backend/src/routes/forms.ts` | Submit a lead from the dashboard's Capture a lead card with example UTM values. The contact appears in HubSpot under the Wix Sync Attribution property group with `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `last_form_page_url`, `last_form_referrer`, `last_form_submitted_at` populated. |
| Fresh lead status | `routes/forms.ts` `upsertContactByEmail` | New leads land in HubSpot with `Lead status = New` and `Lifecycle stage = Lead`. Existing leads are not reset on repeat submissions. |
| Wix webhook signature verification | `backend/src/routes/webhooks.ts` `verifyAndDecodeWixWebhook` | Webhook delivery is a Wix-signed RS256 JWT. We verify with the app's public key. Forged or replayed requests get 401. |
| HubSpot webhook signature verification | `backend/src/routes/webhooks.ts` `verifyHubspotSignature` | Supports both v3 HMAC and legacy v1 signature schemes; v3 reconstruction tolerates host header variation through ngrok and Render's proxy. |

## API plan

| Feature | APIs used |
|---|---|
| Wix → HubSpot contact sync | Wix CRM Contact Created / Updated webhooks (real-time inbound); Wix Contacts v4 REST for outbound reads when syncing the other direction. |
| HubSpot → Wix contact sync | HubSpot Webhooks v3 with subscriptions to `contact.creation` and `contact.propertyChange`; HubSpot CRM Contacts v3 API to read and write contact properties. |
| Form lead capture | Direct POST from a Wix page (Velo or custom HTML element) to our `/api/forms/submit` endpoint; that route then calls HubSpot CRM Contacts API and HubSpot Properties API (to provision the UTM and form-attribution custom properties on first use). |
| Property mapping configuration | HubSpot Properties API `/crm/v3/properties/contacts` to enumerate available properties for the mapping UI; our own `field_mappings` table to persist the user's choices. |

## Database

Five tables, all migrated via `node-pg-migrate`.

```
installations (1) --- (1) hubspot_tokens
              (1) --- (N) field_mappings
              (1) --- (N) contact_id_map
              (1) --- (N) sync_log
```

| Table | Purpose |
|---|---|
| `installations` | One row per Wix instance plus the HubSpot portal it is linked to. |
| `hubspot_tokens` | AES-256-GCM encrypted HubSpot access and refresh tokens, IV and auth tag in separate columns. |
| `field_mappings` | User-configurable Wix field to HubSpot property map, with direction and optional transform. |
| `contact_id_map` | Stable Wix contact id ↔ HubSpot contact id pairs, with one-to-one constraints in each direction. |
| `sync_log` | Append-only audit ledger. Origin, direction, correlation id, payload hash, status. Powers the dedupe window query. |

See `DESIGN.md` for the full architecture, ERD, OAuth flow, and the four-layer loop-prevention reasoning.

## Local development

Prerequisites: Node 20+, npm 10+, Postgres 15+ or Docker Desktop.

```
cp .env.example .env
cp frontend/.env.example frontend/.env
```

Fill in `.env` with values from your HubSpot and Wix apps. Generate the encryption key and internal API token with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Start Postgres:

```
docker compose up -d postgres
```

Install and migrate:

```
cd backend
npm install
npm run migrate up
npm run dev
```

In a second terminal:

```
cd frontend
npm install
npm run dev
```

Dashboard at http://localhost:5173, backend at http://localhost:3000.

For webhook testing in local development, see `docs/NGROK.md`.

## Repository layout

```
backend/
  src/
    config.ts            Strict env validation with zod
    db.ts                pg pool with managed-Postgres SSL handling
    logger.ts            pino with token and PII redaction
    crypto.ts            AES-256-GCM, HMAC, stable JSON hashing
    types.ts             Shared types
    middleware/
      auth.ts            Internal token check for dashboard routes
      errorHandler.ts    HttpError + ZodError translation
      requestContext.ts  Correlation id per request
    repositories/        Typed DB query helpers per table
    services/
      tokenService.ts        HubSpot OAuth + auto-refresh
      hubspotClient.ts       HubSpot CRM + Properties API client
      wixClient.ts           Wix Contacts v4 REST client
      wixInstance.ts         Wix dashboard JWT verification
      propertyBootstrap.ts   Auto-create HubSpot custom property group
      transforms.ts          Trim, lowercase
      loopPrevention.ts      30-second dedupe window
      syncEngine.ts          Bi-directional sync, conflict resolution, idempotency
    routes/
      auth.ts            HubSpot OAuth install / callback / disconnect
      wixApp.ts          Wix install handshake from inside the iframe
      webhooks.ts        HubSpot v1/v3 + Wix RS256 webhook receivers
      sync.ts            Manual resync trigger + activity feed
      mappings.ts        Field mapping CRUD with duplicate validation
      forms.ts           Lead capture from Wix to HubSpot with UTM
      installations.ts   Installation list + status
  migrations/            Five timestamped migrations
  scripts/seed.ts        Demo data
frontend/
  src/
    App.tsx                              Dashboard shell, Wix install detection
    lib/api.ts                           Typed REST client
    components/
      ConnectionPanel.tsx                Connect / Disconnect HubSpot
      MappingTable.tsx                   Field mapping table
      FormTester.tsx                     Capture a lead form
      SyncTester.tsx                     Manual resync trigger
      SyncLogView.tsx                    Activity feed with humanised reasons
    styles.css
docs/NGROK.md            Local webhook testing setup
DESIGN.md                Full architecture, ERD, OAuth flow, loop prevention reasoning
docker-compose.yml       Postgres for local dev
netlify.toml             Netlify build + CSP for Wix iframe embedding
render.yaml              Render service config
```

## Known limitations

- The OAuth state map for the HubSpot install is in process memory. On Render's free tier the instance spins down with inactivity; if more than 50 seconds elapses between clicking Connect and accepting consent, the in-flight state expires and the user has to retry. A production deployment would persist state in Redis or Postgres.
- The internal API token for dashboard-to-backend traffic is a shared secret. A future revision would replace it with the Wix-issued JWT (the same one we verify on iframe load) being passed on subsequent requests as a bearer token.
- The Wix outbound client (`wixClient.ts`) uses Wix's older self-hosted refresh-token pattern where the install token IS the refresh token. If Wix changes that pattern, the token exchange code path is the single place to update.

## Contact

`beliya.anziya2022@gmail.com`
