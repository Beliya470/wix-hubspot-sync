# Privacy policy

## What this app does

Wix HubSpot Sync (the "app") synchronises contact records between a Wix site and a HubSpot account that the site owner authorises. It also captures Wix form submissions and forwards them to HubSpot as leads.

## Data the app collects

The app processes the following personal data on behalf of the site owner:

- Contact email addresses, names, phone numbers, and company names that appear in either the Wix site's contact list or the connected HubSpot account.
- UTM marketing-attribution parameters captured at the moment a Wix form is submitted.
- The Wix site instance identifier issued by Wix during install.
- The HubSpot portal identifier returned during OAuth.

## How the data is stored

- Contact field values are not stored by the app. They pass through the app's sync engine and are written to the destination system (HubSpot or Wix). The app retains only the cross-system identifier pairs (Wix contact id ↔ HubSpot contact id) needed to keep the two systems in step.
- HubSpot OAuth access and refresh tokens are encrypted at rest with AES-256-GCM before being written to the app's database. The encryption key is stored as an environment variable on the app's server and is never written to source files or logs.
- Logs are structured JSON. Token values and the contact PII fields above are removed by a redaction layer before any log line is written.

## How the data is used

The data is used solely to perform the synchronisation requested by the site owner. The app does not analyse, sell, share, or transfer the data to any third party other than:

- HubSpot, which receives contact data when syncing from Wix to HubSpot.
- Wix, which receives contact data when syncing from HubSpot to Wix.

## Retention

- Encrypted HubSpot tokens are kept for as long as the site owner has the app installed. They are deleted when the site owner clicks Disconnect or uninstalls the app.
- The identifier pairs and the sync activity log are retained until the site owner uninstalls the app, at which point they are deleted.

## User rights

Site owners can:

- Disconnect HubSpot at any time from the dashboard. This revokes the refresh token at HubSpot and deletes the encrypted record from the app's database.
- Uninstall the app from their Wix site. This removes the installation row and all associated identifier pairs and sync log entries.

## Contact

Questions about this policy should be sent to `beliya.anziya2022@gmail.com`.
