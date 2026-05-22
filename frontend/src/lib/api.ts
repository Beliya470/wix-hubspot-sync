const TOKEN = import.meta.env.VITE_INTERNAL_API_TOKEN as string | undefined;

if (!TOKEN) {
  // eslint-disable-next-line no-console
  console.warn('VITE_INTERNAL_API_TOKEN is not set. Dashboard requests will fail with 401.');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (TOKEN) headers.set('x-internal-token', TOKEN);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data?.error ?? `request_failed_${res.status}`);
    (err as Error & { details?: unknown }).details = data?.details;
    throw err;
  }
  return data as T;
}

export interface InstallationSummary {
  id: string;
  wix_instance_id: string;
  hubspot_portal_id: string | null;
  status: string;
  connected: boolean;
  updated_at: string;
}

export interface FieldMapping {
  id?: string;
  wix_field: string;
  hubspot_property: string;
  direction: 'wix_to_hubspot' | 'hubspot_to_wix' | 'bidirectional';
  transform: 'trim' | 'lowercase' | null;
}

export interface MappingOptions {
  wix_fields: string[];
  hubspot_properties: string[];
  transforms: Array<'trim' | 'lowercase'>;
  directions: FieldMapping['direction'][];
}

export interface SyncLogEntry {
  id: string;
  origin: string;
  direction: string;
  status: 'started' | 'skipped' | 'succeeded' | 'failed';
  wix_contact_id: string | null;
  hubspot_contact_id: string | null;
  error_message: string | null;
  created_at: string;
}

export const api = {
  listInstallations: () => request<{ installations: InstallationSummary[] }>(`/api/installations`),
  disconnect: (installationId: string) =>
    request<{ status: string }>(`/auth/hubspot/disconnect`, {
      method: 'POST',
      body: JSON.stringify({ installation_id: installationId }),
    }),
  options: (installationId: string) =>
    request<MappingOptions>(`/api/mappings/options?installation_id=${encodeURIComponent(installationId)}`),
  listMappings: (installationId: string) =>
    request<{ mappings: FieldMapping[] }>(`/api/mappings/${installationId}`),
  saveMappings: (installationId: string, mappings: FieldMapping[]) =>
    request<{ status: string; count: number }>(`/api/mappings`, {
      method: 'PUT',
      body: JSON.stringify({ installation_id: installationId, mappings }),
    }),
  syncLog: (installationId: string) =>
    request<{ entries: SyncLogEntry[] }>(`/api/sync/log/${installationId}`),
  trigger: (
    installationId: string,
    payload: { direction: 'wix_to_hubspot'; wix_contact_id: string }
      | { direction: 'hubspot_to_wix'; hubspot_contact_id: string },
  ) =>
    request<{ status: string; reason?: string; wix_contact_id?: string; hubspot_contact_id?: string }>(`/api/sync/trigger`, {
      method: 'POST',
      body: JSON.stringify({ installation_id: installationId, ...payload }),
    }),
};

export interface FormSubmissionInput {
  wix_instance_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  company?: string;
  utm?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
  };
  page_url?: string;
  referrer?: string;
  submitted_at?: string;
}

// /api/forms/submit is the route a Wix page would call directly, so it does
// not require the internal token. We call it from the dashboard tester via
// fetch() rather than the api helper so the wire shape matches production.
export async function submitForm(body: FormSubmissionInput): Promise<{ contact_id: string; created: boolean }> {
  const res = await fetch('/api/forms/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data?.error ?? `form_submit_failed_${res.status}`);
  return data;
}

// Builds the install URL. The browser is sent to the backend, which redirects
// to HubSpot's consent screen.
export function buildInstallUrl(wixInstanceId: string): string {
  return `/auth/hubspot/install?wix_instance_id=${encodeURIComponent(wixInstanceId)}`;
}
