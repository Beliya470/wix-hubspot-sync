import { query, withTransaction } from '../db';
import { FieldMapping, SyncDirection, TransformId } from '../types';

export async function list(installationId: string): Promise<FieldMapping[]> {
  const result = await query<FieldMapping>(
    'SELECT id, installation_id, wix_field, hubspot_property, direction, transform FROM field_mappings WHERE installation_id = $1 ORDER BY wix_field',
    [installationId],
  );
  return result.rows;
}

export interface MappingInput {
  wix_field: string;
  hubspot_property: string;
  direction: SyncDirection;
  transform: TransformId;
}

// Atomic replace: clears and reinserts a full mapping set for one
// installation. Saves us from per-row dance on the dashboard side.
export async function replaceAll(installationId: string, mappings: MappingInput[]): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM field_mappings WHERE installation_id = $1', [installationId]);
    for (const m of mappings) {
      await client.query(
        `INSERT INTO field_mappings (installation_id, wix_field, hubspot_property, direction, transform)
         VALUES ($1, $2, $3, $4, $5)`,
        [installationId, m.wix_field, m.hubspot_property, m.direction, m.transform],
      );
    }
  });
}
