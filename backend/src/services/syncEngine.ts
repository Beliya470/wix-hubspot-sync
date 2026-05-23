import crypto from 'crypto';
import { logger } from '../logger';
import * as mappingsRepo from '../repositories/mappings';
import * as contactMapRepo from '../repositories/contactMap';
import * as installationsRepo from '../repositories/installations';
import * as syncLog from '../repositories/syncLog';
import * as hubspot from './hubspotClient';
import * as wix from './wixClient';
import { applyTransform } from './transforms';
import { isLoopEcho } from './loopPrevention';
import { stableHash } from '../crypto';
import {
  ContactRecord,
  FieldMapping,
  SyncContext,
  SyncDirection,
  SyncOrigin,
} from '../types';

interface CommonInput {
  installationId: string;
  correlationId?: string;
  origin: SyncOrigin;
}

export type SyncEvent =
  | (CommonInput & {
      kind: 'wix_contact_changed';
      wixContactId: string;
      // Optional inline contact snapshot from the webhook payload. When
      // present we skip the Wix API fetch and use this data directly.
      wixContactSnapshot?: import('./wixClient').WixContact;
    })
  | (CommonInput & { kind: 'hubspot_contact_changed'; hubspotContactId: string });

export interface SyncResult {
  status: 'succeeded' | 'skipped' | 'failed';
  reason?: string;
  wixContactId?: string;
  hubspotContactId?: string;
}

// Public entry point. Routes (webhooks, manual triggers, form submissions)
// build a SyncEvent and call this; the engine handles direction, loop
// prevention, conflict resolution and logging.
export async function handle(event: SyncEvent): Promise<SyncResult> {
  const ctx: SyncContext = {
    installationId: event.installationId,
    correlationId: event.correlationId ?? crypto.randomUUID(),
    origin: event.origin,
  };
  logger.info({ ctx, kind: event.kind }, 'sync event received');
  try {
    if (event.kind === 'wix_contact_changed') {
      return await syncWixToHubspot(ctx, event.wixContactId, event.wixContactSnapshot);
    }
    return await syncHubspotToWix(ctx, event.hubspotContactId);
  } catch (err) {
    logger.error({ ctx, err }, 'sync engine failure');
    await syncLog.append({
      installationId: ctx.installationId,
      origin: ctx.origin,
      direction: event.kind === 'wix_contact_changed' ? 'wix_to_hubspot' : 'hubspot_to_wix',
      correlationId: ctx.correlationId,
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

async function syncWixToHubspot(
  ctx: SyncContext,
  wixContactId: string,
  snapshot?: import('./wixClient').WixContact,
): Promise<SyncResult> {
  const direction: SyncDirection = 'wix_to_hubspot';

  if (await isLoopEcho({ installationId: ctx.installationId, origin: ctx.origin, wixContactId })) {
    return await skip(ctx, direction, 'loop_echo', { wixContactId });
  }

  // If the caller (a Wix webhook) already passed the full contact snapshot
  // in the event, use it directly. Wix webhooks include the entire contact
  // entity in createdEvent.entity / updatedEvent.entity, so the extra API
  // round-trip is unnecessary and avoids the Wix outbound auth path.
  let wixContact: import('./wixClient').WixContact | null = snapshot ?? null;
  if (!wixContact) {
    const { wixInstanceId } = await loadInstanceId(ctx.installationId);
    wixContact = await wix.getContact(wixInstanceId, wixContactId);
  }
  if (!wixContact) {
    return await skip(ctx, direction, 'wix_contact_not_found', { wixContactId });
  }

  const mappings = await mappingsRepo.list(ctx.installationId);
  const wixNormalized = wix.normalizeContact(wixContact);
  const wixSource: ContactRecord = {
    email: wixNormalized.email,
    firstName: wixNormalized.firstName,
    lastName: wixNormalized.lastName,
    phone: wixNormalized.phone,
    company: wixNormalized.company,
  };

  const hubspotPayload = buildPayload(mappings, wixSource, 'wix_to_hubspot', 'hubspot_property');
  if (Object.keys(hubspotPayload).length === 0) {
    return await skip(ctx, direction, 'no_mapped_fields', { wixContactId });
  }

  let mapping = await contactMapRepo.findByWix(ctx.installationId, wixContactId);

  let hubspotContact: hubspot.HubspotContact;
  if (mapping) {
    // Idempotency check: skip if HubSpot already holds these exact values.
    const existing = await hubspot.getContact(ctx.installationId, mapping.hubspot_contact_id);
    if (existing) {
      const conflict = resolveConflict({
        sourceUpdatedAt: wixNormalized.updatedAt,
        targetUpdatedAt: existing.updatedAt,
      });
      if (conflict === 'target_wins') {
        return await skip(ctx, direction, 'target_newer', { wixContactId, hubspotContactId: mapping.hubspot_contact_id });
      }
      if (valuesIdentical(existing.properties, hubspotPayload)) {
        return await skip(ctx, direction, 'idempotent_no_change', {
          wixContactId, hubspotContactId: mapping.hubspot_contact_id,
        });
      }
    }
    hubspotContact = await hubspot.updateContact(ctx.installationId, mapping.hubspot_contact_id, hubspotPayload);
  } else {
    // No existing link: try matching on email first to avoid duplicates.
    const email = hubspotPayload.email;
    if (email) {
      const existing = await hubspot.findContactByEmail(ctx.installationId, email);
      if (existing) {
        hubspotContact = await hubspot.updateContact(ctx.installationId, existing.id, hubspotPayload);
      } else {
        hubspotContact = await hubspot.createContact(ctx.installationId, hubspotPayload);
      }
    } else {
      hubspotContact = await hubspot.createContact(ctx.installationId, hubspotPayload);
    }
    mapping = await contactMapRepo.upsert({
      installationId: ctx.installationId,
      wixContactId,
      hubspotContactId: hubspotContact.id,
    });
  }

  await syncLog.append({
    installationId: ctx.installationId,
    origin: ctx.origin,
    direction,
    correlationId: ctx.correlationId,
    wixContactId,
    hubspotContactId: hubspotContact.id,
    status: 'succeeded',
    payloadHash: stableHash(hubspotPayload),
  });

  return {
    status: 'succeeded',
    wixContactId,
    hubspotContactId: hubspotContact.id,
  };
}

async function syncHubspotToWix(ctx: SyncContext, hubspotContactId: string): Promise<SyncResult> {
  const direction: SyncDirection = 'hubspot_to_wix';

  if (await isLoopEcho({ installationId: ctx.installationId, origin: ctx.origin, hubspotContactId })) {
    return await skip(ctx, direction, 'loop_echo', { hubspotContactId });
  }

  const { wixInstanceId } = await loadInstanceId(ctx.installationId);

  const hubspotContact = await hubspot.getContact(ctx.installationId, hubspotContactId);
  if (!hubspotContact) {
    return await skip(ctx, direction, 'hubspot_contact_not_found', { hubspotContactId });
  }

  const mappings = await mappingsRepo.list(ctx.installationId);
  const hubspotSource: ContactRecord = { ...hubspotContact.properties };

  const wixPayload = buildPayload(mappings, hubspotSource, 'hubspot_to_wix', 'wix_field');
  if (Object.keys(wixPayload).length === 0) {
    return await skip(ctx, direction, 'no_mapped_fields', { hubspotContactId });
  }

  let mapping = await contactMapRepo.findByHubspot(ctx.installationId, hubspotContactId);

  // Translate the flat record back into Wix's nested ContactInfo shape via
  // the field names produced by buildPayload (firstName, lastName, etc.).
  const wixInput = {
    email: wixPayload.email ?? undefined,
    firstName: wixPayload.firstName ?? undefined,
    lastName: wixPayload.lastName ?? undefined,
    phone: wixPayload.phone ?? undefined,
    company: wixPayload.company ?? undefined,
  };

  let wixContactId: string;
  if (mapping) {
    const existing = await wix.getContact(wixInstanceId, mapping.wix_contact_id);
    if (existing) {
      const conflict = resolveConflict({
        sourceUpdatedAt: hubspotContact.updatedAt,
        targetUpdatedAt: existing.updatedDate ?? null,
      });
      if (conflict === 'target_wins') {
        return await skip(ctx, direction, 'target_newer', {
          wixContactId: mapping.wix_contact_id, hubspotContactId,
        });
      }
      const existingNormalized = wix.normalizeContact(existing);
      const existingFlat = {
        email: existingNormalized.email,
        firstName: existingNormalized.firstName,
        lastName: existingNormalized.lastName,
        phone: existingNormalized.phone,
        company: existingNormalized.company,
      };
      if (valuesIdentical(existingFlat as ContactRecord, wixPayload)) {
        return await skip(ctx, direction, 'idempotent_no_change', {
          wixContactId: mapping.wix_contact_id, hubspotContactId,
        });
      }
      await wix.updateContact(wixInstanceId, mapping.wix_contact_id, wixInput, existing.revision);
      wixContactId = mapping.wix_contact_id;
    } else {
      const created = await wix.createContact(wixInstanceId, wixInput);
      wixContactId = created.id;
    }
  } else {
    if (wixInput.email) {
      const existing = await wix.findContactByEmail(wixInstanceId, wixInput.email);
      if (existing) {
        await wix.updateContact(wixInstanceId, existing.id, wixInput, existing.revision);
        wixContactId = existing.id;
      } else {
        const created = await wix.createContact(wixInstanceId, wixInput);
        wixContactId = created.id;
      }
    } else {
      const created = await wix.createContact(wixInstanceId, wixInput);
      wixContactId = created.id;
    }
    mapping = await contactMapRepo.upsert({
      installationId: ctx.installationId,
      wixContactId,
      hubspotContactId,
    });
  }

  await syncLog.append({
    installationId: ctx.installationId,
    origin: ctx.origin,
    direction,
    correlationId: ctx.correlationId,
    wixContactId,
    hubspotContactId,
    status: 'succeeded',
    payloadHash: stableHash(wixPayload),
  });

  return {
    status: 'succeeded',
    wixContactId,
    hubspotContactId,
  };
}

interface ConflictArgs {
  sourceUpdatedAt: string | null | undefined;
  targetUpdatedAt: string | null | undefined;
}

// Last-updated-wins conflict resolution. If both timestamps are available and
// the target is strictly newer, we leave it alone.
function resolveConflict({ sourceUpdatedAt, targetUpdatedAt }: ConflictArgs): 'source_wins' | 'target_wins' {
  if (!sourceUpdatedAt || !targetUpdatedAt) return 'source_wins';
  const s = Date.parse(sourceUpdatedAt);
  const t = Date.parse(targetUpdatedAt);
  if (Number.isNaN(s) || Number.isNaN(t)) return 'source_wins';
  return t > s ? 'target_wins' : 'source_wins';
}

// Builds the outbound payload keyed by the *target* field name.
function buildPayload(
  mappings: FieldMapping[],
  source: ContactRecord,
  direction: SyncDirection,
  targetKey: 'hubspot_property' | 'wix_field',
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of mappings) {
    if (m.direction !== direction && m.direction !== 'bidirectional') continue;
    const sourceKey = targetKey === 'hubspot_property' ? m.wix_field : m.hubspot_property;
    const raw = source[sourceKey];
    if (raw === undefined || raw === null || raw === '') continue;
    const transformed = applyTransform(raw, m.transform);
    if (transformed === null) continue;
    out[m[targetKey]] = transformed;
  }
  return out;
}

function valuesIdentical(existing: Record<string, string | null>, next: Record<string, string>): boolean {
  for (const key of Object.keys(next)) {
    if ((existing[key] ?? '') !== next[key]) return false;
  }
  return true;
}

async function skip(
  ctx: SyncContext,
  direction: SyncDirection,
  reason: string,
  ids: { wixContactId?: string; hubspotContactId?: string },
): Promise<SyncResult> {
  logger.info({ ctx, reason, ids }, 'sync skipped');
  await syncLog.append({
    installationId: ctx.installationId,
    origin: ctx.origin,
    direction,
    correlationId: ctx.correlationId,
    wixContactId: ids.wixContactId,
    hubspotContactId: ids.hubspotContactId,
    status: 'skipped',
    errorMessage: reason,
  });
  return { status: 'skipped', reason, ...ids };
}

async function loadInstanceId(installationId: string): Promise<{ wixInstanceId: string }> {
  const installation = await installationsRepo.getById(installationId);
  if (!installation) throw new Error(`installation not found: ${installationId}`);
  return { wixInstanceId: installation.wix_instance_id };
}
