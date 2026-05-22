import * as syncLog from '../repositories/syncLog';
import { SyncOrigin } from '../types';

// 30-second window in which a successful write of our own is treated as the
// cause of any inbound webhook that fires for the same contact. Reading from
// any one bound (e.g. Wix or HubSpot id) is enough because both ids land in
// sync_log entries written by our own sync engine.
export const DEDUPE_WINDOW_SECONDS = 30;

export interface DedupeCheckParams {
  installationId: string;
  origin: SyncOrigin;
  wixContactId?: string;
  hubspotContactId?: string;
}

// Returns true if we believe this inbound event was caused by our own recent
// write. The rule: if the most recent successful sync entry for this contact
// inside the dedupe window was driven by *our* write into the *other* system,
// then the inbound event is the echo of that write and must be skipped.
export async function isLoopEcho(params: DedupeCheckParams): Promise<boolean> {
  const recent = await syncLog.recentForContact({
    installationId: params.installationId,
    wixContactId: params.wixContactId,
    hubspotContactId: params.hubspotContactId,
    withinSeconds: DEDUPE_WINDOW_SECONDS,
  });
  if (!recent) return false;
  // The inbound event reports an update in `params.origin`. If our recent
  // write was a sync running *into* that same system, the event is its echo.
  if (params.origin === 'hubspot' && recent.direction === 'wix_to_hubspot') return true;
  if (params.origin === 'wix' && recent.direction === 'hubspot_to_wix') return true;
  return false;
}
