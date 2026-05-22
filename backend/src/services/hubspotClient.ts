import axios, { AxiosInstance, AxiosError } from 'axios';
import { getValidAccessToken } from './tokenService';
import { logger } from '../logger';

const HUBSPOT_API = 'https://api.hubapi.com';

export interface HubspotContact {
  id: string;
  properties: Record<string, string | null>;
  updatedAt: string;
}

function makeClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: HUBSPOT_API,
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
}

async function withClient<T>(installationId: string, fn: (client: AxiosInstance) => Promise<T>): Promise<T> {
  const token = await getValidAccessToken(installationId);
  return fn(makeClient(token));
}

export async function getContact(installationId: string, contactId: string): Promise<HubspotContact | null> {
  return withClient(installationId, async (client) => {
    try {
      const { data } = await client.get<HubspotContact>(`/crm/v3/objects/contacts/${contactId}`, {
        params: { properties: 'email,firstname,lastname,phone,company,website,lifecyclestage' },
      });
      return data;
    } catch (err) {
      if (isStatus(err, 404)) return null;
      throw err;
    }
  });
}

export async function findContactByEmail(installationId: string, email: string): Promise<HubspotContact | null> {
  return withClient(installationId, async (client) => {
    const { data } = await client.post<{ results: HubspotContact[] }>(
      '/crm/v3/objects/contacts/search',
      {
        filterGroups: [
          {
            filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
          },
        ],
        properties: ['email', 'firstname', 'lastname', 'phone', 'company', 'website', 'lifecyclestage'],
        limit: 1,
      },
    );
    return data.results[0] ?? null;
  });
}

export async function createContact(installationId: string, properties: Record<string, string>): Promise<HubspotContact> {
  return withClient(installationId, async (client) => {
    const { data } = await client.post<HubspotContact>('/crm/v3/objects/contacts', { properties });
    return data;
  });
}

export async function updateContact(installationId: string, contactId: string, properties: Record<string, string>): Promise<HubspotContact> {
  return withClient(installationId, async (client) => {
    const { data } = await client.patch<HubspotContact>(`/crm/v3/objects/contacts/${contactId}`, { properties });
    return data;
  });
}

export async function listContactProperties(installationId: string): Promise<string[]> {
  return withClient(installationId, async (client) => {
    const { data } = await client.get<{ results: Array<{ name: string }> }>('/crm/v3/properties/contacts');
    return data.results.map((p) => p.name);
  });
}

// Convenience helper: create-or-update by email. Used by the form submission
// route where we have an email but no HubSpot id yet. `createOnlyProperties`
// are merged into the payload only when creating a new contact, so values
// like `hs_lead_status = NEW` do not overwrite progress on repeat submissions.
export async function upsertContactByEmail(
  installationId: string,
  email: string,
  properties: Record<string, string>,
  createOnlyProperties: Record<string, string> = {},
): Promise<{ contact: HubspotContact; created: boolean }> {
  const existing = await findContactByEmail(installationId, email);
  if (existing) {
    const merged = { ...properties, email };
    const contact = await updateContact(installationId, existing.id, merged);
    return { contact, created: false };
  }
  const contact = await createContact(installationId, { ...createOnlyProperties, ...properties, email });
  return { contact, created: true };
}

function isStatus(err: unknown, status: number): boolean {
  return err instanceof AxiosError && err.response?.status === status;
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  try {
    await axios.delete(`${HUBSPOT_API}/oauth/v1/refresh-tokens/${refreshToken}`);
  } catch (err) {
    // Best effort: HubSpot may already have revoked it or rotated it.
    logger.warn({ err }, 'failed to revoke hubspot refresh token');
  }
}
