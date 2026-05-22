import axios, { AxiosError, AxiosInstance } from 'axios';
import { getValidAccessToken } from './tokenService';
import { logger } from '../logger';
import { HttpError } from '../middleware/errorHandler';

interface ContactPropertyDef {
  name: string;
  label: string;
  type: 'string' | 'datetime';
  fieldType: 'text' | 'date';
  description: string;
}

// The custom HubSpot contact properties this app writes to. They are grouped
// under a dedicated property group so a HubSpot admin can see at a glance
// what came from this integration.
const REQUIRED_PROPERTIES: ContactPropertyDef[] = [
  { name: 'utm_source', label: 'UTM Source', type: 'string', fieldType: 'text', description: 'Original traffic source captured from the visitor.' },
  { name: 'utm_medium', label: 'UTM Medium', type: 'string', fieldType: 'text', description: 'Original marketing channel captured from the visitor.' },
  { name: 'utm_campaign', label: 'UTM Campaign', type: 'string', fieldType: 'text', description: 'Original marketing campaign captured from the visitor.' },
  { name: 'utm_term', label: 'UTM Term', type: 'string', fieldType: 'text', description: 'Paid search keyword captured from the visitor.' },
  { name: 'utm_content', label: 'UTM Content', type: 'string', fieldType: 'text', description: 'Creative variant captured from the visitor.' },
  { name: 'last_form_page_url', label: 'Last Form Page URL', type: 'string', fieldType: 'text', description: 'URL of the page where the most recent form submission happened.' },
  { name: 'last_form_referrer', label: 'Last Form Referrer', type: 'string', fieldType: 'text', description: 'Referrer of the most recent form submission.' },
  { name: 'last_form_submitted_at', label: 'Last Form Submitted At', type: 'datetime', fieldType: 'date', description: 'Timestamp of the most recent form submission.' },
];

const GROUP_NAME = 'wix_sync_attribution';
const GROUP_LABEL = 'Wix Sync Attribution';

const PROPERTY_CACHE_TTL_MS = 60_000;

interface PropertyCacheEntry {
  knownProperties: Set<string>;
  groupExists: boolean;
  fetchedAt: number;
}

const propertyCache = new Map<string, PropertyCacheEntry>();

export function resetBootstrapState(installationId: string): void {
  propertyCache.delete(installationId);
}

async function refreshPropertyCache(
  installationId: string,
  client: AxiosInstance,
): Promise<PropertyCacheEntry> {
  let knownProperties: Set<string>;
  try {
    const { data } = await client.get<{ results: Array<{ name: string }> }>('/crm/v3/properties/contacts');
    knownProperties = new Set(data.results.map((p) => p.name));
  } catch (err) {
    throw httpFromHubspotError(err, 'list contact properties');
  }

  let groupExists = false;
  try {
    await client.get(`/crm/v3/properties/contacts/groups/${GROUP_NAME}`);
    groupExists = true;
  } catch (err) {
    if (!(err instanceof AxiosError) || err.response?.status !== 404) {
      throw httpFromHubspotError(err, 'check property group');
    }
  }

  const entry: PropertyCacheEntry = { knownProperties, groupExists, fetchedAt: Date.now() };
  propertyCache.set(installationId, entry);
  return entry;
}

async function getCache(installationId: string, client: AxiosInstance): Promise<PropertyCacheEntry> {
  const cached = propertyCache.get(installationId);
  if (cached && Date.now() - cached.fetchedAt < PROPERTY_CACHE_TTL_MS) return cached;
  return refreshPropertyCache(installationId, client);
}

async function ensurePropertyGroup(client: AxiosInstance, cache: PropertyCacheEntry): Promise<void> {
  if (cache.groupExists) return;
  try {
    await client.post('/crm/v3/properties/contacts/groups', {
      name: GROUP_NAME,
      label: GROUP_LABEL,
      displayOrder: -1,
    });
    cache.groupExists = true;
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 409) {
      // Group was created concurrently; treat as existing.
      cache.groupExists = true;
      return;
    }
    throw httpFromHubspotError(err, 'create property group');
  }
}

// Tries to batch-create all missing properties in one HubSpot call. Falls
// back to per-property creation if the batch endpoint errors so a single bad
// property cannot block the others. Returns the names that were created and
// any that failed.
async function createMissingProperties(
  client: AxiosInstance,
  missing: ContactPropertyDef[],
): Promise<{ created: string[]; failures: Array<{ name: string; error: string; status?: number }> }> {
  const created: string[] = [];
  const failures: Array<{ name: string; error: string; status?: number }> = [];

  const inputs = missing.map((p) => ({
    name: p.name,
    label: p.label,
    type: p.type,
    fieldType: p.fieldType,
    description: p.description,
    groupName: GROUP_NAME,
  }));

  try {
    await client.post('/crm/v3/properties/contacts/batch/create', { inputs });
    return { created: missing.map((p) => p.name), failures };
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 403) {
      throw httpFromHubspotError(err, 'create contact properties');
    }
    logger.warn(
      { err, count: missing.length },
      'HubSpot batch property create failed; falling back to individual create',
    );
  }

  for (const prop of missing) {
    try {
      await client.post('/crm/v3/properties/contacts', {
        name: prop.name,
        label: prop.label,
        type: prop.type,
        fieldType: prop.fieldType,
        description: prop.description,
        groupName: GROUP_NAME,
      });
      created.push(prop.name);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 403) {
        throw httpFromHubspotError(err, `create contact property "${prop.name}"`);
      }
      const status = err instanceof AxiosError ? err.response?.status : undefined;
      const message = err instanceof AxiosError
        ? ((err.response?.data as { message?: string } | undefined)?.message ?? err.message)
        : err instanceof Error ? err.message : String(err);
      failures.push({ name: prop.name, error: message, status });
    }
  }

  return { created, failures };
}

export async function ensureCustomProperties(installationId: string): Promise<void> {
  const token = await getValidAccessToken(installationId);
  const client = axios.create({
    baseURL: 'https://api.hubapi.com',
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15_000,
  });

  const cache = await getCache(installationId, client);
  const missing = REQUIRED_PROPERTIES.filter((p) => !cache.knownProperties.has(p.name));
  if (missing.length === 0) return;

  await ensurePropertyGroup(client, cache);

  const { created, failures } = await createMissingProperties(client, missing);

  if (created.length > 0) {
    for (const name of created) cache.knownProperties.add(name);
    logger.info(
      { installationId, group: GROUP_NAME, created },
      'created HubSpot custom properties',
    );
  }

  if (failures.length > 0) {
    throw new HttpError(502, 'hubspot_property_creation_failed', {
      created,
      failed: failures,
      hint: 'Some custom properties could not be created on HubSpot. Resolve the listed errors and reconnect.',
    });
  }
}

function httpFromHubspotError(err: unknown, action: string): Error {
  if (err instanceof AxiosError && err.response) {
    const status = err.response.status;
    const data = err.response.data as { message?: string; category?: string } | undefined;
    if (status === 403) {
      return new HttpError(403, 'hubspot_scope_missing', {
        action,
        required_scope: 'crm.schemas.contacts.write',
        how_to_fix: [
          'Open your HubSpot developer app at https://developers.hubspot.com',
          'Go to the Auth tab',
          'Under Required scopes, add "crm.schemas.contacts.write"',
          'Click Save changes at the bottom of the page',
          'Then click Disconnect on the dashboard and reconnect to get a new token with the new scope',
        ],
      });
    }
    return new HttpError(status, 'hubspot_api_error', {
      action,
      hubspot_message: data?.message ?? err.message,
      hubspot_category: data?.category,
    });
  }
  return new HttpError(502, 'hubspot_unreachable', {
    action,
    message: err instanceof Error ? err.message : String(err),
  });
}
