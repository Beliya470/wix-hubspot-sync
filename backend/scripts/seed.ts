import { closeDb, query } from '../src/db';
import * as installationsRepo from '../src/repositories/installations';
import * as mappingsRepo from '../src/repositories/mappings';
import { logger } from '../src/logger';

async function main() {
  const wixInstanceId = process.env.SEED_WIX_INSTANCE_ID ?? 'demo-wix-instance';
  const portalId = process.env.SEED_HUBSPOT_PORTAL_ID ?? null;

  const installation = await installationsRepo.upsert({
    wixInstanceId,
    hubspotPortalId: portalId,
    status: portalId ? 'connected' : 'pending',
  });

  await mappingsRepo.replaceAll(installation.id, [
    { wix_field: 'email', hubspot_property: 'email', direction: 'bidirectional', transform: 'lowercase' },
    { wix_field: 'firstName', hubspot_property: 'firstname', direction: 'bidirectional', transform: 'trim' },
    { wix_field: 'lastName', hubspot_property: 'lastname', direction: 'bidirectional', transform: 'trim' },
    { wix_field: 'phone', hubspot_property: 'phone', direction: 'wix_to_hubspot', transform: null },
    { wix_field: 'company', hubspot_property: 'company', direction: 'bidirectional', transform: null },
  ]);

  const counts = await query<{ table: string; count: string }>(
    `SELECT 'installations' AS table, count(*)::text FROM installations
     UNION ALL SELECT 'field_mappings', count(*)::text FROM field_mappings
     UNION ALL SELECT 'contact_id_map', count(*)::text FROM contact_id_map
     UNION ALL SELECT 'sync_log', count(*)::text FROM sync_log
     UNION ALL SELECT 'hubspot_tokens', count(*)::text FROM hubspot_tokens`,
  );
  logger.info({ installationId: installation.id, counts: counts.rows }, 'seed complete');
}

main()
  .catch((err) => {
    logger.error({ err }, 'seed failed');
    process.exitCode = 1;
  })
  .finally(closeDb);
