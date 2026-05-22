# Wix HubSpot Sync

A self-hosted Wix app that connects a Wix site to HubSpot and keeps contacts in sync both ways. Wix form submissions are pushed into HubSpot with marketing attribution. A small dashboard lets the site owner connect or disconnect HubSpot, decide which fields flow between the two systems, and watch every sync event as it happens.

## What's in the repo

```
backend/    Express API: OAuth, sync engine, webhooks, form capture
frontend/   React dashboard
docs/       Operational guides (ngrok setup)
docker-compose.yml   Postgres for local development
DESIGN.md   Architecture, ERD, sync engine and loop prevention details, API plan
```

## What you need

* Node.js 20 or newer
* npm 10 or newer
* Either Docker Desktop (to use the bundled Postgres) or a Postgres 15 or newer instance you can reach over the network
* A HubSpot developer account (free) and an app set up in it
* A Wix developer account if you intend to wire up the Wix side end to end

## Setup

### 1. Configuration

Copy the example env files:

```
cp .env.example .env
cp frontend/.env.example frontend/.env
```

Fill in the values listed in `.env`. The required ones are:

* `DATABASE_URL` (default works with docker-compose)
* `ENCRYPTION_KEY` (32-byte hex, generate it once and keep it stable)
* `INTERNAL_API_TOKEN` (any long random string, paste the same value into `frontend/.env`)
* `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_REDIRECT_URI` from your HubSpot app's Auth tab
* `HUBSPOT_AUTH_BASE_URL` is `https://app.hubspot.com` for US portals or `https://app-eu1.hubspot.com` for EU portals. Check your HubSpot account's data centre

Generate the two random keys with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Database

If you have Docker:

```
docker compose up -d postgres
```

If you do not, install Postgres locally (for example with winget on Windows: `winget install PostgreSQL.PostgreSQL.16`) and adjust `DATABASE_URL` to match the username, password, host, and database you set during install.

### 3. Backend

```
cd backend
npm install
npm run migrate up
npm run dev
```

You should see a JSON log line ending in `"msg":"backend listening"` and `http://localhost:3000/health` returns `{"status":"ok"}`.

### 4. Frontend

In a second terminal:

```
cd frontend
npm install
npm run dev
```

The dashboard is at `http://localhost:5173`.

## HubSpot app configuration

In your HubSpot developer app's Auth tab:

1. Add `http://localhost:3000/auth/hubspot/callback` to the redirect URLs (or your ngrok URL for webhook testing).
2. Under required scopes, add all five:
   * `oauth`
   * `crm.objects.contacts.read`
   * `crm.objects.contacts.write`
   * `crm.schemas.contacts.read`
   * `crm.schemas.contacts.write` (so the app can auto-create the custom UTM and form-attribution properties)
3. Click **Save changes** at the bottom of the page. This is easy to miss.

## Demo path for a reviewer

1. Open `http://localhost:5173`.
2. In the Connection card, type any string as a Wix instance id (for example `demo-1`) and click **Connect HubSpot**.
3. Accept the consent screen in HubSpot. You will be redirected back to the dashboard and the status will switch to **Connected**.
4. In the Field mapping card, the table loads HubSpot's actual contact properties. Add a few rows mapping Wix fields to HubSpot properties, choose directions, and click **Save mapping**. Refresh the page to confirm the mappings persist.
5. In the Capture a lead card, click **Try with example data**, then **Submit lead**. The lead is created in HubSpot within a couple of seconds. You will see a new row in the Activity card and a new contact in HubSpot with the UTM properties populated.
6. Submit the same lead again. The Activity card now logs the second attempt as **Skipped** with the reason "no field values changed". This is the idempotency check stopping a ping-pong loop.
7. In the Resync a contact card, paste a HubSpot contact id and click **Sync now**. The Activity card records the run.
8. Click **Disconnect** in the Connection card to revoke the HubSpot refresh token and clear the stored credentials.

## Optional: live webhooks via ngrok

Webhooks let HubSpot tell the app the moment a contact changes inside HubSpot. To wire them up locally, see `docs/NGROK.md`. The short version:

1. `ngrok http 3000` exposes the local backend at an HTTPS URL.
2. In the HubSpot app's Webhooks tab, set the target URL to `https://<ngrok>/webhooks/hubspot` and subscribe to `contact.creation` and `contact.propertyChange`.
3. Paste the webhook signing secret into `HUBSPOT_WEBHOOK_SECRET` in `.env` and restart the backend.

## A note on the Wix side

The code path for outbound Wix calls (in `backend/src/services/wixClient.ts`) is implemented against the Wix Contacts v4 REST API and uses the same OAuth refresh pattern as HubSpot. We did not exercise it end to end because doing so requires a real Wix app secret and a Wix sandbox site to push events from. The bi-directional sync engine treats Wix and HubSpot symmetrically, so once `WIX_APP_SECRET` is set and a webhook URL is registered with Wix, the Wix-to-HubSpot direction comes alive without changing engine code. The form submission endpoint at `POST /api/forms/submit` is the path a Wix form actually posts to in production, and it is fully working.

## Troubleshooting

* **Invalid environment configuration** at backend boot. Your `.env` is missing or malformed. The error names the offending keys. `ENCRYPTION_KEY` must be 64 hex characters.
* **`relation does not exist`** in backend logs. The migrations haven't run. From `backend/`, run `npm run migrate up`.
* **`401 unauthorized`** on dashboard requests. The token in `frontend/.env` does not match `INTERNAL_API_TOKEN` in `.env`.
* **HubSpot callback shows `redirect_uri mismatch`**. The `HUBSPOT_REDIRECT_URI` in `.env` does not exactly match a URL in HubSpot's Auth tab.
* **HubSpot consent screen reports a scope mismatch**. You added scopes in HubSpot but did not click **Save changes** at the bottom of the page.
* **Webhook returns `invalid_signature`**. The webhook secret in `.env` does not match the one HubSpot or Wix is signing with.
* **OAuth callback returns `invalid_or_expired_state`**. The backend restarted between clicking Connect and accepting the consent screen (the state map is in memory) or more than five minutes passed.

## Project structure

```
backend/
  src/
    config.ts          Strict env validation with zod
    db.ts              pg pool + transaction helper
    logger.ts          pino with token and PII redaction
    crypto.ts          AES-256-GCM, HMAC, stable JSON hashing
    types.ts           Shared types
    middleware/
      auth.ts          Internal token check
      errorHandler.ts  Typed HttpError + global handler
      requestContext.ts  Correlation id per request
    repositories/
      installations.ts, tokens.ts, mappings.ts,
      contactMap.ts, syncLog.ts
    services/
      tokenService.ts    HubSpot OAuth and auto-refresh
      hubspotClient.ts   CRM and Properties API client
      wixClient.ts       Wix Contacts v4 client
      transforms.ts      Trim and lowercase
      loopPrevention.ts  30-second dedupe window check
      syncEngine.ts      Bi-directional sync
    routes/
      auth.ts, webhooks.ts, sync.ts,
      mappings.ts, forms.ts, installations.ts
  migrations/          Five timestamped migrations
  scripts/seed.ts      Demo data
frontend/
  src/
    App.tsx
    lib/api.ts         Typed REST client
    components/
      ConnectionPanel.tsx
      MappingTable.tsx
      FormTester.tsx
      SyncTester.tsx
      SyncLogView.tsx
    styles.css
```
