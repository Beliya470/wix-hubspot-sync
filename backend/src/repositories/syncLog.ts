import { query } from '../db';
import { SyncDirection, SyncOrigin, SyncStatus } from '../types';

export interface SyncLogRow {
  id: string;
  installation_id: string;
  origin: SyncOrigin;
  direction: SyncDirection;
  correlation_id: string;
  wix_contact_id: string | null;
  hubspot_contact_id: string | null;
  status: SyncStatus;
  payload_hash: string | null;
  error_message: string | null;
  created_at: Date;
}

export async function append(entry: {
  installationId: string;
  origin: SyncOrigin;
  direction: SyncDirection;
  correlationId: string;
  wixContactId?: string | null;
  hubspotContactId?: string | null;
  status: SyncStatus;
  payloadHash?: string | null;
  errorMessage?: string | null;
}): Promise<SyncLogRow> {
  const r = await query<SyncLogRow>(
    `INSERT INTO sync_log (installation_id, origin, direction, correlation_id,
                           wix_contact_id, hubspot_contact_id, status,
                           payload_hash, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      entry.installationId,
      entry.origin,
      entry.direction,
      entry.correlationId,
      entry.wixContactId ?? null,
      entry.hubspotContactId ?? null,
      entry.status,
      entry.payloadHash ?? null,
      entry.errorMessage ?? null,
    ],
  );
  return r.rows[0]!;
}

// Returns the most recent successful sync entry for a contact id within the
// dedupe window. The sync engine uses this to recognise that an inbound
// webhook was caused by a write we just made.
export async function recentForContact(params: {
  installationId: string;
  wixContactId?: string;
  hubspotContactId?: string;
  withinSeconds: number;
}): Promise<SyncLogRow | null> {
  const conditions: string[] = ['installation_id = $1', "status = 'succeeded'"];
  const values: unknown[] = [params.installationId];
  let i = 2;
  if (params.wixContactId) {
    conditions.push(`wix_contact_id = $${i++}`);
    values.push(params.wixContactId);
  }
  if (params.hubspotContactId) {
    conditions.push(`hubspot_contact_id = $${i++}`);
    values.push(params.hubspotContactId);
  }
  conditions.push(`created_at > now() - ($${i++} || ' seconds')::interval`);
  values.push(String(params.withinSeconds));

  const r = await query<SyncLogRow>(
    `SELECT * FROM sync_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT 1`,
    values,
  );
  return r.rows[0] ?? null;
}

export async function listForInstallation(installationId: string, limit = 50): Promise<SyncLogRow[]> {
  const r = await query<SyncLogRow>(
    'SELECT * FROM sync_log WHERE installation_id = $1 ORDER BY created_at DESC LIMIT $2',
    [installationId, limit],
  );
  return r.rows;
}
