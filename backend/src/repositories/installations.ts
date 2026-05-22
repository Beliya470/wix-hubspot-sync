import { query } from '../db';
import { Installation } from '../types';

export async function getById(id: string): Promise<Installation | null> {
  const result = await query<Installation>('SELECT * FROM installations WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function getByWixInstanceId(wixInstanceId: string): Promise<Installation | null> {
  const result = await query<Installation>(
    'SELECT * FROM installations WHERE wix_instance_id = $1',
    [wixInstanceId],
  );
  return result.rows[0] ?? null;
}

export async function getByHubspotPortalId(portalId: string): Promise<Installation | null> {
  const result = await query<Installation>(
    'SELECT * FROM installations WHERE hubspot_portal_id = $1',
    [portalId],
  );
  return result.rows[0] ?? null;
}

export async function upsert(params: {
  wixInstanceId: string;
  hubspotPortalId?: string | null;
  status?: string;
}): Promise<Installation> {
  const result = await query<Installation>(
    `INSERT INTO installations (wix_instance_id, hubspot_portal_id, status)
     VALUES ($1, $2, COALESCE($3, 'pending'))
     ON CONFLICT (wix_instance_id) DO UPDATE
       SET hubspot_portal_id = COALESCE(EXCLUDED.hubspot_portal_id, installations.hubspot_portal_id),
           status            = COALESCE(EXCLUDED.status, installations.status),
           updated_at        = now()
     RETURNING *`,
    [params.wixInstanceId, params.hubspotPortalId ?? null, params.status ?? null],
  );
  return result.rows[0]!;
}

export async function setHubspotPortalId(id: string, portalId: string): Promise<void> {
  await query(
    `UPDATE installations
        SET hubspot_portal_id = $2,
            status            = 'connected',
            updated_at        = now()
      WHERE id = $1`,
    [id, portalId],
  );
}

export async function markDisconnected(id: string): Promise<void> {
  await query(
    `UPDATE installations
        SET hubspot_portal_id = NULL,
            status            = 'disconnected',
            updated_at        = now()
      WHERE id = $1`,
    [id],
  );
}

export async function list(): Promise<Installation[]> {
  const result = await query<Installation>('SELECT * FROM installations ORDER BY created_at DESC');
  return result.rows;
}
