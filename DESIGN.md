# Design

This document explains *why* the project is shaped the way it is. The README
covers *how* to run it.

## Goals and constraints

- The Wix app is **self-hosted**. The backend is the only server in the
  picture; Wix and HubSpot both talk to it over OAuth, REST, and webhooks.
- Contacts must sync in **both directions** without loops or stale-write
  conflicts.
- The HubSpot OAuth token must never reach the browser.
- The mapping between Wix fields and HubSpot properties is **user-configurable
  at runtime**, not in code.
- Form submissions on a Wix site must land in HubSpot with **UTM
  attribution** preserved.

## High-level architecture

```
+---------+      OAuth        +-----------+      REST      +----------+
|  Wix    | <---------------> |  Backend  | <------------> | HubSpot  |
| site    |   webhooks +      |  (Express)|   webhooks +   |  CRM     |
| owner   |   form submits    |           |   REST         |          |
+---------+ ----------------> |           | -------------> +----------+
                              |   +---+   |
   +----------------------->  |   |DB |   |
   |  Dashboard (React)       |   +---+   |
   |  REST only, internal     +-----------+
   |  shared token                Postgres
   +-----------
```

All credentials live in the backend. The dashboard authenticates with a single
internal token; the user pastes the same value into `INTERNAL_API_TOKEN`
(backend) and `VITE_INTERNAL_API_TOKEN` (frontend). In a real Wix-published
build this would be replaced with a verified Wix-issued JWT. Either way the
constraint that **tokens never reach the browser** holds.

## Database: five tables

```
installations (1) --- (1) hubspot_tokens
              (1) --- (N) field_mappings
              (1) --- (N) contact_id_map
              (1) --- (N) sync_log
```

| Table | Purpose | Notes |
|-------|---------|-------|
| `installations` | One row per installed Wix instance. Tracks the HubSpot portal it is connected to and current status. | `wix_instance_id` is the natural key. |
| `hubspot_tokens` | Per-installation HubSpot OAuth tokens. | Access and refresh tokens are stored as AES-256-GCM ciphertext + iv + auth tag. Encryption happens in the app layer so the key never lives in Postgres. |
| `field_mappings` | User-configurable map between Wix fields and HubSpot properties. | `direction` enum: `wix_to_hubspot`, `hubspot_to_wix`, `bidirectional`. `transform` is `trim` or `lowercase`. |
| `contact_id_map` | Stable link between a Wix contact id and a HubSpot contact id. | Triple unique constraint (`installation`, `wix_id`, `hubspot_id`) and one-to-one constraints in each direction. |
| `sync_log` | Append-only audit + dedupe ledger. | Indexed for the dedupe window query: `(installation_id, hubspot_contact_id, created_at)` and `(installation_id, wix_contact_id, created_at)`. |

See `backend/migrations/` for the exact column definitions.

## OAuth flow

1. The dashboard opens `GET /auth/hubspot/install?wix_instance_id=<id>`.
2. The backend generates a CSRF-safe `state`, stores it bound to the
   `wix_instance_id`, and redirects the browser to HubSpot's authorize URL.
3. The user grants access; HubSpot redirects back to
   `GET /auth/hubspot/callback?code=...&state=...`.
4. The backend validates `state`, exchanges `code` for tokens, looks up the
   HubSpot portal id (via `/oauth/v1/access-tokens/<token>`), and upserts both
   the `installations` and `hubspot_tokens` rows. Tokens are encrypted before
   they touch Postgres.
5. The browser is redirected back to the dashboard with `?installation=<id>&connected=1`.

`POST /auth/hubspot/disconnect` revokes the refresh token via HubSpot's
revocation endpoint, deletes the token row, and marks the installation
disconnected.

`tokenService.getValidAccessToken(installationId)`:

- Loads the encrypted record, decrypts in-memory.
- If `expires_at` is within a 60-second buffer of now, calls HubSpot's refresh
  endpoint, re-encrypts, persists, and returns the new access token.
- Otherwise returns the current one. The HubSpot client uses this for every
  outbound call, so callers don't think about token lifetime.

## Sync engine and loop prevention

The hardest part of bi-directional sync is making sure that **`A → B` doesn't
boomerang back as `B → A`**. The engine uses four independent defences and any
one of them is sufficient on its own; together they make echoes impossible.

### 1. `contact_id_map` lookups

Once a Wix contact and a HubSpot contact have been linked, both sides
already know each other's id. New contacts that show up on either side and
match by email are linked into the same row before any write happens, so we
never create a parallel duplicate.

### 2. Origin tag + 30 second dedupe window

`sync_log` records every successful write with:

- `origin`: which system triggered this run (`wix`, `hubspot`, `form`,
  `manual`)
- `direction`: which way we wrote (`wix_to_hubspot` or `hubspot_to_wix`)
- `correlation_id`: a uuid threaded from the inbound request

When a webhook fires, the engine looks for any successful sync entry for the
same contact id within the last 30 seconds. If it finds one whose `direction`
was *into the system the webhook came from*, this inbound event must be the
echo of that write, and the engine logs a `skipped` entry with reason
`loop_echo` instead of writing again.

30 seconds was chosen as a comfortable upper bound on the typical webhook
propagation lag from HubSpot / Wix. It's a knob: production deployments would
tune it from observability data.

### 3. Idempotency comparison

Before issuing an `update`, the engine fetches the target record's current
property values and compares the mapped subset to what we are about to write.
If they're identical, it logs `idempotent_no_change` and exits. This kills
infinite loops that would survive a clock skew on the dedupe window, and also
saves API call budget when nothing actually changed.

### 4. Last-updated-wins conflict resolution

If both records have an `updatedAt` timestamp and the target's is **strictly
newer** than the source's, the source loses. The engine logs `target_newer`
and skips. Otherwise the source wins. Bi-directional sync without a
deterministic conflict rule will eventually corrupt data; this rule is
trivially explainable to the user and easy to extend (we could swap in
`hubspot_wins` per-field via the mapping table without changing engine code).

### Why those four together?

Each one alone has an edge case:

- The id map alone can't stop the first-ever update from echoing.
- The dedupe window alone fails after a long pause if a webhook delivers
  late.
- Idempotency alone fails on cosmetic re-saves (e.g. HubSpot trimming).
- Conflict resolution alone fails on creates.

Layered, they cover each other's blind spots.

### Engine flow

`backend/src/services/syncEngine.ts` exposes a single `handle(event)` entry
point. Each handler:

1. Checks the dedupe window → skip if echo.
2. Reads the source record from the originating system.
3. Builds the outbound payload from `field_mappings`, applying transforms.
4. Looks up `contact_id_map`. If linked, compares values for idempotency and
   updates; if not, tries email match and either links or creates.
5. Writes a `sync_log` entry (succeeded / skipped / failed) with the
   correlation id and a stable hash of the payload.

## Field mapping UI

The dashboard's `MappingTable.tsx` is a controlled-input table that:

- Loads `/api/mappings/options?installation_id=…` to populate Wix field and
  HubSpot property dropdowns (HubSpot properties come from
  `GET /crm/v3/properties/contacts` live).
- Loads existing mappings via `/api/mappings/:id`.
- Lets the user edit row-by-row, validates duplicates client-side, and
  PUTs the full list back.

Duplicate validation runs in two places: the dashboard prevents the user
from clicking Save with conflicting rows, and the backend repeats the check
in `routes/mappings.ts` so a custom REST client can't bypass it. Same
hubspot property can appear twice if (and only if) the two rows are opposite
single-direction mappings. That covers the legitimate "use this property only
when syncing one way" case.

## Form & lead capture

`POST /api/forms/submit` accepts the canonical Wix form payload shape (we
control the wire format because the Wix page calls this endpoint directly):

```json
{
  "wix_instance_id": "<id>",
  "email": "lead@example.com",
  "first_name": "...", "last_name": "...", "phone": "...", "company": "...",
  "custom_fields": { "anything": "value" },
  "utm": { "utm_source": "...", "utm_medium": "...", ... },
  "page_url": "...", "referrer": "...", "submitted_at": "ISO-8601",
  "wix_contact_id": "<optional>"
}
```

The route maps the canonical body to HubSpot properties (`email`, `firstname`,
`lastname`, `phone`, `company`, `utm_source`, `utm_medium`, `utm_campaign`,
`utm_term`, `utm_content`, `last_form_page_url`, `last_form_referrer`,
`last_form_submitted_at`) and `upsertContactByEmail`. A `sync_log` row with
`origin = 'form'` makes the activity visible in the dashboard.

If the Wix form also produces a `wix_contact_id`, the route links it in
`contact_id_map` so subsequent updates flow through the bi-directional
engine.

## Webhook receivers

`POST /webhooks/hubspot` and `POST /webhooks/wix` both:

1. Read the raw request body (mounted as `express.raw` only on these routes
   so the rest of the app can use `express.json`).
2. Verify the signature with the appropriate `_WEBHOOK_SECRET`:
   - HubSpot uses the v3 scheme: `base64(hmac_sha256(secret, method + url + body + timestamp))`. Requests older than 5 minutes are rejected.
   - Wix sends either a JWT-style signature in `x-wix-webhook-signature` or a digest header. We verify the signature segment with the app secret.
3. Acknowledge with `202 Accepted` immediately and process events
   asynchronously through `syncEngine.handle(...)`.

## Security checklist

- AES-256-GCM token encryption at rest, key from `ENCRYPTION_KEY` env var
  only.
- HMAC signature verification on both webhook routes; constant-time compare.
- pino redaction of `authorization`, cookies, tokens, and PII paths.
- CORS limited to the dashboard origin.
- helmet headers.
- Zod validation on every input boundary.
- Internal token gate on dashboard endpoints and on the disconnect route.

## API plan per feature

### Feature #1: Bi-directional contact sync

| Direction | Trigger | API |
|-----------|---------|-----|
| Wix → HubSpot | `POST /webhooks/wix` (Wix Contacts v4 webhooks) | HubSpot CRM Contacts API (`POST /crm/v3/objects/contacts`, `PATCH /crm/v3/objects/contacts/{id}`, `POST /crm/v3/objects/contacts/search`) |
| HubSpot → Wix | `POST /webhooks/hubspot` (HubSpot Webhooks v3, subscribed to `contact.creation` and `contact.propertyChange`) | Wix Contacts v4 API (`POST /contacts/v4/contacts`, `PATCH /contacts/v4/contacts/{id}`, `POST /contacts/v4/contacts/query`) |
| Both | `POST /api/sync/trigger` for manual / testing | Same as above |

Why this set:

- HubSpot's v3 contacts API is the only fully-supported surface for
  programmatic create/update with property selection.
- HubSpot's v3 webhooks deliver per-portal events; we filter by
  `subscriptionType` to ignore non-contact events.
- Wix's Contacts v4 (REST) is the public, stable surface that all self-hosted
  apps integrate through; v3 is deprecated.

### Feature #2: Form and lead capture

| Step | API |
|------|-----|
| Capture on the Wix page | The site embeds a small script that posts a JSON body to `POST /api/forms/submit` on our backend, including any UTM cookies. |
| Upsert in HubSpot | HubSpot CRM Contacts API search-by-email + create-or-patch via the same client. |
| Attribution storage | UTM, page URL, referrer, and submission time are written as HubSpot contact properties (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `last_form_page_url`, `last_form_referrer`, `last_form_submitted_at`). |
| Visibility | A `sync_log` row with `origin = 'form'` is created for every submission, surfaced in the dashboard. |

This approach was chosen over embedding HubSpot forms because the assignment
prizes attribution control: using Wix as the UI and pushing to HubSpot gives
us full visibility over the field schema and the network call. (Both options
are documented in the assignment.)
