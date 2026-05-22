# Exposing the local backend to HubSpot and Wix

HubSpot and Wix can only call webhook endpoints that resolve on the public
internet. While developing, the simplest approach is `ngrok`, which tunnels a
public HTTPS URL to your local backend port.

## 1. Install ngrok

- Windows (winget): `winget install Ngrok.Ngrok`
- Or download from https://ngrok.com/download

## 2. Authenticate

Create a free ngrok account, copy the auth token from the ngrok dashboard, then:

```
ngrok config add-authtoken <your-token>
```

## 3. Start the tunnel

In a new terminal, with the backend already running on port 3000:

```
ngrok http 3000
```

ngrok will print something like:

```
Forwarding   https://abcd-1234.ngrok-free.app -> http://localhost:3000
```

That HTTPS URL is what you give to HubSpot and Wix.

## 4. Register the webhook URLs

- **HubSpot:** in your developer app, under *Webhooks*, set the Target URL to
  `https://<ngrok>/webhooks/hubspot` and subscribe to `contact.creation` and
  `contact.propertyChange` for the properties you care about (email, firstname,
  lastname, phone, company).
- **Wix:** in your app's dashboard under *Webhooks*, register `contacts/v4/contact_updated`
  and `contacts/v4/contact_created` pointing at `https://<ngrok>/webhooks/wix`.

Both providers sign their webhooks. Paste the signing secrets they show into
`HUBSPOT_WEBHOOK_SECRET` and `WIX_WEBHOOK_SECRET` in your `.env`.

## 5. OAuth callback

While ngrok is running, set `HUBSPOT_REDIRECT_URI` in `.env` to
`https://<ngrok>/auth/hubspot/callback` *and* register the same URL in
HubSpot's app **Auth** tab. ngrok URLs change on free plans, so this needs to
match each time you restart the tunnel. Pin a reserved domain on a paid
plan to keep it stable.

## 6. Skipping ngrok during pure local testing

You can exercise the sync engine and forms endpoint without exposing the
backend at all. `npm run seed` creates an installation, and the
`/api/sync/trigger` and `/api/forms/submit` endpoints can be hit directly from
`curl` or the dashboard. Webhook-driven flows are the only paths that need
public ingress.
