# Wix Velo integration for form submissions

This snippet runs inside a Wix site (Velo backend code) and forwards every Wix form submission to this app's `/api/forms/submit` endpoint so the lead lands in HubSpot with full UTM attribution.

Add it to your Wix site once. Then any Wix Form on any page that posts to the standard `wix-crm-backend` contact pipeline will also push the lead to HubSpot.

## 1. Enable Velo

In the Wix Editor (or Studio), turn on Dev Mode if it is not already on. Velo gives you a backend folder where you can add Node-like JavaScript files.

## 2. Add a backend file

Create `backend/wix-hubspot-forward.js` in your Wix site and paste:

```javascript
import { fetch } from 'wix-fetch';
import wixData from 'wix-data';
import { getJSON } from 'wix-fetch';

// Set this to the production backend URL.
const SYNC_URL = 'https://wix-hubspot-sync-backend.onrender.com/api/forms/submit';

// Optional: set this if you used a different Wix instance id during install.
// Leave empty to use the site's runtime instance id.
const STATIC_INSTANCE_ID = '';

export async function forwardSubmissionToHubspot(submission, context) {
  const fields = submission.submissionData ?? {};
  const utm = submission.utm ?? {};
  const body = {
    wix_instance_id: STATIC_INSTANCE_ID || context.instanceId,
    email: fields.email,
    first_name: fields.first_name || fields.firstName,
    last_name: fields.last_name || fields.lastName,
    phone: fields.phone,
    company: fields.company,
    utm: {
      utm_source: utm.source,
      utm_medium: utm.medium,
      utm_campaign: utm.campaign,
      utm_term: utm.term,
      utm_content: utm.content,
    },
    page_url: context.pageUrl,
    referrer: context.referrer,
    submitted_at: new Date().toISOString(),
  };
  try {
    const res = await fetch(SYNC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('hubspot forward failed', res.status, await res.text());
    }
  } catch (err) {
    console.error('hubspot forward error', err);
  }
}
```

## 3. Wire it to your form's onWixFormSubmit

In the page code for the page that contains your form, add:

```javascript
import { forwardSubmissionToHubspot } from 'backend/wix-hubspot-forward.js';
import wixWindow from 'wix-window';

$w.onReady(() => {
  $w('#wixForms1').onWixFormSubmit(async (event) => {
    const utm = wixWindow.lightbox.getContext()?.utm ?? {};
    await forwardSubmissionToHubspot(event, {
      instanceId: wixWindow.appInfo?.instanceId,
      pageUrl: wixWindow.location?.url,
      referrer: document.referrer,
    });
  });
});
```

Replace `#wixForms1` with the ID of your Wix Form element if it's different.

## 4. What gets captured

The HubSpot contact created or updated by this flow has, in addition to the standard fields:

- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` (from the URL the visitor clicked)
- `last_form_page_url` (the page the form was on)
- `last_form_referrer` (where the visitor came from)
- `last_form_submitted_at` (the timestamp)
- `hs_lead_status` set to `NEW` and `lifecyclestage` set to `lead` on first create only

All eight of those properties are auto-created on the HubSpot portal the first time the app runs against it (see `backend/src/services/propertyBootstrap.ts`).
