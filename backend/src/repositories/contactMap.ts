import { query } from '../db';
import { ContactIdMap } from '../types';

export async function findByWix(installationId: string, wixId: string): Promise<ContactIdMap | null> {
  const r = await query<ContactIdMap>(
    'SELECT * FROM contact_id_map WHERE installation_id = $1 AND wix_contact_id = $2',
    [installationId, wixId],
  );
  return r.rows[0] ?? null;
}

export async function findByHubspot(installationId: string, hubspotId: string): Promise<ContactIdMap | null> {
  const r = await query<ContactIdMap>(
    'SELECT * FROM contact_id_map WHERE installation_id = $1 AND hubspot_contact_id = $2',
    [installationId, hubspotId],
  );
  return r.rows[0] ?? null;
}

export async function upsert(params: {
  installationId: string;
  wixContactId: string;
  hubspotContactId: string;
}): Promise<ContactIdMap> {
  const r = await query<ContactIdMap>(
    `INSERT INTO contact_id_map (installation_id, wix_contact_id, hubspot_contact_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (installation_id, wix_contact_id) DO UPDATE
       SET hubspot_contact_id = EXCLUDED.hubspot_contact_id,
           updated_at         = now()
     RETURNING *`,
    [params.installationId, params.wixContactId, params.hubspotContactId],
  );
  return r.rows[0]!;
}
