export type SyncDirection = 'wix_to_hubspot' | 'hubspot_to_wix' | 'bidirectional';
export type SyncOrigin = 'wix' | 'hubspot' | 'form' | 'manual';
export type SyncStatus = 'started' | 'skipped' | 'succeeded' | 'failed';
export type TransformId = 'trim' | 'lowercase' | null;

export interface Installation {
  id: string;
  wix_instance_id: string;
  hubspot_portal_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface HubspotTokenRecord {
  installation_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  portal_id: string;
}

export interface FieldMapping {
  id: string;
  installation_id: string;
  wix_field: string;
  hubspot_property: string;
  direction: SyncDirection;
  transform: TransformId;
}

export interface ContactIdMap {
  id: string;
  installation_id: string;
  wix_contact_id: string;
  hubspot_contact_id: string;
}

// Canonical contact shape used inside the sync engine. Both Wix and HubSpot
// payloads are normalised into this shape before any write decision is made.
export type ContactRecord = Record<string, string | null>;

export interface SyncContext {
  installationId: string;
  correlationId: string;
  origin: SyncOrigin;
}
