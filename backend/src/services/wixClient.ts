import axios, { AxiosError } from 'axios';
import { config } from '../config';
import { logger } from '../logger';

// The Wix Contacts REST surface lives at this base. Self-hosted apps talk to
// it via an instance-scoped access token issued by Wix during the OAuth flow.
const WIX_API = 'https://www.wixapis.com';

export interface WixContact {
  id: string;
  revision?: number;
  info: {
    name?: { first?: string; last?: string };
    emails?: { items?: Array<{ email: string; primary?: boolean }> };
    phones?: { items?: Array<{ phone: string; primary?: boolean }> };
    company?: string;
    extendedFields?: { items?: Record<string, unknown> };
  };
  createdDate?: string;
  updatedDate?: string;
}

interface WixToken {
  accessToken: string;
  refreshToken: string;
}

// Wix self-hosted apps obtain instance-scoped access tokens by exchanging the
// app's instance refresh token for a short-lived access token. The rest of
// the sync engine talks only to these functions, so this is the single point
// to update once real Wix app credentials are available.
async function getInstanceToken(instanceId: string): Promise<WixToken> {
  if (!config.WIX_APP_SECRET || !config.WIX_APP_ID) {
    throw new Error(
      'Wix app credentials missing. Set WIX_APP_ID and WIX_APP_SECRET in .env to enable outbound Wix calls.',
    );
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.WIX_APP_ID,
    client_secret: config.WIX_APP_SECRET,
    refresh_token: instanceId,
  });
  const { data } = await axios.post<{ access_token: string; refresh_token: string }>(
    `${WIX_API}/oauth/access`,
    body.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

async function client(instanceId: string) {
  const { accessToken } = await getInstanceToken(instanceId);
  return axios.create({
    baseURL: WIX_API,
    headers: { Authorization: accessToken },
    timeout: 15_000,
  });
}

export async function getContact(instanceId: string, contactId: string): Promise<WixContact | null> {
  try {
    const c = await client(instanceId);
    const { data } = await c.get<{ contact: WixContact }>(`/contacts/v4/contacts/${contactId}`);
    return data.contact;
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) return null;
    logger.warn({ err }, 'wix getContact failed');
    throw err;
  }
}

export interface WixContactInput {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  extendedFields?: Record<string, string>;
}

function toWixPayload(input: WixContactInput) {
  return {
    info: {
      name: {
        first: input.firstName,
        last: input.lastName,
      },
      emails: input.email ? { items: [{ email: input.email, primary: true, tag: 'MAIN' }] } : undefined,
      phones: input.phone ? { items: [{ phone: input.phone, primary: true, tag: 'MAIN' }] } : undefined,
      company: input.company,
      extendedFields: input.extendedFields ? { items: input.extendedFields } : undefined,
    },
  };
}

export async function createContact(instanceId: string, input: WixContactInput): Promise<WixContact> {
  const c = await client(instanceId);
  const { data } = await c.post<{ contact: WixContact }>(
    '/contacts/v4/contacts',
    toWixPayload(input),
  );
  return data.contact;
}

export async function updateContact(instanceId: string, contactId: string, input: WixContactInput, revision?: number): Promise<WixContact> {
  const c = await client(instanceId);
  const { data } = await c.patch<{ contact: WixContact }>(
    `/contacts/v4/contacts/${contactId}`,
    { ...toWixPayload(input), revision },
  );
  return data.contact;
}

export async function findContactByEmail(instanceId: string, email: string): Promise<WixContact | null> {
  const c = await client(instanceId);
  const { data } = await c.post<{ contacts: WixContact[] }>('/contacts/v4/contacts/query', {
    query: {
      filter: { 'info.emails.email': { $eq: email } },
      paging: { limit: 1 },
    },
  });
  return data.contacts[0] ?? null;
}

export function normalizeContact(contact: WixContact): {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  company: string | null;
  updatedAt: string | null;
} {
  const email = contact.info.emails?.items?.find((e) => e.primary)?.email
    ?? contact.info.emails?.items?.[0]?.email
    ?? null;
  const phone = contact.info.phones?.items?.find((p) => p.primary)?.phone
    ?? contact.info.phones?.items?.[0]?.phone
    ?? null;
  return {
    email,
    firstName: contact.info.name?.first ?? null,
    lastName: contact.info.name?.last ?? null,
    phone,
    company: contact.info.company ?? null,
    updatedAt: contact.updatedDate ?? null,
  };
}
