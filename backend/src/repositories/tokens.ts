import { query } from '../db';
import { decrypt, encrypt } from '../crypto';
import { HubspotTokenRecord } from '../types';

interface TokenRow {
  installation_id: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_token_tag: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_tag: string;
  expires_at: Date;
  portal_id: string;
}

function rowToRecord(row: TokenRow): HubspotTokenRecord {
  return {
    installation_id: row.installation_id,
    access_token: decrypt({
      ciphertext: row.access_token_ciphertext,
      iv: row.access_token_iv,
      tag: row.access_token_tag,
    }),
    refresh_token: decrypt({
      ciphertext: row.refresh_token_ciphertext,
      iv: row.refresh_token_iv,
      tag: row.refresh_token_tag,
    }),
    expires_at: row.expires_at,
    portal_id: row.portal_id,
  };
}

export async function getByInstallationId(installationId: string): Promise<HubspotTokenRecord | null> {
  const result = await query<TokenRow>(
    'SELECT * FROM hubspot_tokens WHERE installation_id = $1',
    [installationId],
  );
  if (!result.rows[0]) return null;
  return rowToRecord(result.rows[0]);
}

export async function upsert(params: {
  installationId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  portalId: string;
}): Promise<void> {
  const at = encrypt(params.accessToken);
  const rt = encrypt(params.refreshToken);
  await query(
    `INSERT INTO hubspot_tokens (
        installation_id,
        access_token_ciphertext, access_token_iv, access_token_tag,
        refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
        expires_at, portal_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (installation_id) DO UPDATE
       SET access_token_ciphertext  = EXCLUDED.access_token_ciphertext,
           access_token_iv          = EXCLUDED.access_token_iv,
           access_token_tag         = EXCLUDED.access_token_tag,
           refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
           refresh_token_iv         = EXCLUDED.refresh_token_iv,
           refresh_token_tag        = EXCLUDED.refresh_token_tag,
           expires_at               = EXCLUDED.expires_at,
           portal_id                = EXCLUDED.portal_id,
           updated_at               = now()`,
    [
      params.installationId,
      at.ciphertext, at.iv, at.tag,
      rt.ciphertext, rt.iv, rt.tag,
      params.expiresAt,
      params.portalId,
    ],
  );
}

export async function deleteByInstallationId(installationId: string): Promise<void> {
  await query('DELETE FROM hubspot_tokens WHERE installation_id = $1', [installationId]);
}
