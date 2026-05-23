import { Router, raw } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../logger';
import { HttpError } from '../middleware/errorHandler';
import { hmacSha256Base64, safeEqual } from '../crypto';
import * as installationsRepo from '../repositories/installations';
import * as syncEngine from '../services/syncEngine';

export const webhooksRouter = Router();

// Both webhook routes need the raw request body for signature verification.
// HubSpot posts with content-type application/json. Wix posts with
// text/plain because the body is a raw JWT, not JSON. Accept either by
// returning true from the type matcher; verification still rejects anything
// that does not look like a signed payload.
const rawJson = raw({ type: () => true, limit: '1mb' });

function jsonBody<T>(buf: Buffer): T {
  return JSON.parse(buf.toString('utf8')) as T;
}

function verifyHubspotSignature(req: import('express').Request, raw: Buffer): boolean {
  if (!config.HUBSPOT_WEBHOOK_SECRET) return false;
  const v3Sig = req.header('x-hubspot-signature-v3');
  const v1Sig = req.header('x-hubspot-signature');
  const ts = req.header('x-hubspot-request-timestamp');
  const bodyString = raw.toString('utf8');

  // v3: base64(hmac_sha256(secret, method + uri + body + timestamp))
  if (v3Sig && ts) {
    if (Math.abs(Date.now() - Number(ts)) <= 5 * 60 * 1000) {
      const proto = (req.header('x-forwarded-proto') ?? req.protocol) || 'https';
      const host = req.header('x-forwarded-host') ?? req.header('host');
      const candidateUrls = [
        `https://${host}${req.originalUrl}`,
        `${proto}://${host}${req.originalUrl}`,
        `http://${host}${req.originalUrl}`,
      ];
      for (const url of candidateUrls) {
        const base = `${req.method}${url}${bodyString}${ts}`;
        const expected = hmacSha256Base64(config.HUBSPOT_WEBHOOK_SECRET, base);
        if (safeEqual(expected, v3Sig)) return true;
      }
    }
  }

  // v1: sha256(client_secret + body) hex. Used by legacy webhook subscriptions.
  if (v1Sig) {
    const expected = crypto
      .createHash('sha256')
      .update(config.HUBSPOT_WEBHOOK_SECRET + bodyString)
      .digest('hex');
    if (safeEqual(expected, v1Sig)) return true;
  }

  logger.warn(
    {
      has_v3: !!v3Sig,
      has_v1: !!v1Sig,
      ts,
      body_length: raw.length,
      method: req.method,
      url: `${req.header('x-forwarded-proto')}://${req.header('x-forwarded-host')}${req.originalUrl}`,
    },
    'hubspot signature mismatch',
  );
  return false;
}

// Wix delivers a JWT signed with RS256 using their private key. We verify it
// with the public key configured for the app (WIX_WEBHOOK_PUBLIC_KEY).
//
// The JWT body has two nested wrappers:
//   { iat, exp, data: { instanceId, eventType, identity, webhookId,
//                       data: "{escaped JSON event}" or { ... event ... } } }
//
// We pull both layers out: `meta` (the one that carries instanceId) and
// `event` (the one that carries entityId, entityFqdn, slug, createdEvent).
type DecodedWebhook = { meta: Record<string, unknown>; event: Record<string, unknown> };

function unwrapJsonField(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value as Record<string, unknown>;
  return null;
}

function verifyAndDecodeWixWebhook(raw: Buffer): DecodedWebhook | null {
  if (!config.WIX_WEBHOOK_PUBLIC_KEY) {
    logger.warn('WIX_WEBHOOK_PUBLIC_KEY not set; rejecting wix webhook');
    return null;
  }
  const token = raw.toString('utf8').trim();
  if (token.split('.').length !== 3) return null;
  try {
    const decoded = jwt.verify(token, config.WIX_WEBHOOK_PUBLIC_KEY, {
      algorithms: ['RS256'],
    });
    if (typeof decoded !== 'object' || decoded === null) return null;
    const envelope = decoded as Record<string, unknown>;

    // First unwrap: envelope.data is the meta layer.
    const meta = ('data' in envelope ? unwrapJsonField(envelope.data) : null) ?? envelope;

    // Second unwrap: meta.data is the actual event. If absent, treat meta as
    // the event so older webhook shapes still parse.
    const event = ('data' in meta ? unwrapJsonField(meta.data) : null) ?? meta;

    return { meta, event };
  } catch (err) {
    logger.warn({ err }, 'wix webhook jwt verification failed');
    return null;
  }
}

function pick(obj: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function nested(obj: Record<string, unknown> | undefined, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

// HubSpot delivers either a bare array of events (the common legacy webhook
// shape) or an object with an `events` field. Accept both.
const hubspotEvent = z.object({
  subscriptionType: z.string(),
  objectId: z.union([z.string(), z.number()]),
  portalId: z.union([z.string(), z.number()]).optional(),
  eventId: z.union([z.string(), z.number()]).optional(),
}).passthrough();

const hubspotPayload = z.union([
  z.array(hubspotEvent),
  z.object({ events: z.array(hubspotEvent) }).passthrough(),
]);

webhooksRouter.post('/hubspot', rawJson, async (req, res, next) => {
  try {
    if (!verifyHubspotSignature(req, req.body as Buffer)) {
      throw new HttpError(401, 'invalid_signature');
    }
    const parsed = hubspotPayload.parse(jsonBody<unknown>(req.body as Buffer));
    const events = Array.isArray(parsed) ? parsed : parsed.events;

    const portalIds = new Set<string>();
    for (const e of events) if (e.portalId !== undefined) portalIds.add(String(e.portalId));

    // Acknowledge fast, process asynchronously to keep webhook latency low.
    res.status(202).json({ accepted: events.length });

    for (const e of events) {
      const portalId = String(e.portalId ?? Array.from(portalIds)[0] ?? '');
      if (!portalId) continue;
      const installation = await installationsRepo.getByHubspotPortalId(portalId);
      if (!installation) {
        logger.warn({ portalId }, 'hubspot webhook for unknown installation');
        continue;
      }
      if (!e.subscriptionType.startsWith('contact.')) continue;
      await syncEngine.handle({
        kind: 'hubspot_contact_changed',
        hubspotContactId: String(e.objectId),
        installationId: installation.id,
        origin: 'hubspot',
        correlationId: req.correlationId,
      });
    }
  } catch (err) {
    next(err);
  }
});

// Wix's developer dashboard pings the webhook URL with GET when you save a
// subscription, to confirm the endpoint exists. Reply 200 so the dashboard
// accepts the URL. Real webhook deliveries always arrive as POST below.
webhooksRouter.get('/wix', (_req, res) => {
  res.status(200).json({ ok: true });
});

webhooksRouter.post('/wix', rawJson, async (req, res, next) => {
  try {
    const verified = verifyAndDecodeWixWebhook(req.body as Buffer);
    if (!verified) {
      throw new HttpError(401, 'invalid_signature');
    }
    const { meta, event } = verified;

    const wixInstanceId =
      pick(meta, 'instanceId') ??
      (nested(meta, 'metadata', 'instanceId') as string | undefined) ??
      pick(event, 'instanceId');

    if (!wixInstanceId) {
      logger.warn(
        { metaKeys: Object.keys(meta), eventKeys: Object.keys(event) },
        'wix webhook missing instance id',
      );
      throw new HttpError(400, 'missing_instance_id');
    }

    const installation = await installationsRepo.getByWixInstanceId(wixInstanceId);
    if (!installation) {
      throw new HttpError(404, 'unknown_installation', { wixInstanceId });
    }

    // Only act on contact events.
    const fqdn = pick(event, 'entityFqdn');
    if (fqdn && !fqdn.startsWith('wix.contacts')) {
      res.status(202).json({ accepted: false, reason: 'not_a_contact_event' });
      return;
    }

    const contactId =
      pick(event, 'entityId') ??
      (nested(event, 'createdEvent', 'entity', 'id') as string | undefined) ??
      (nested(event, 'updatedEvent', 'entity', 'id') as string | undefined) ??
      (nested(event, 'actionEvent', 'body', 'contact', 'id') as string | undefined) ??
      (nested(event, 'actionEvent', 'body', 'contactId') as string | undefined) ??
      (nested(event, 'data', 'contactId') as string | undefined) ??
      (nested(event, 'data', 'contact', 'id') as string | undefined);

    if (!contactId) {
      logger.warn({ eventKeys: Object.keys(event) }, 'wix webhook missing contact id');
      throw new HttpError(400, 'missing_contact_id');
    }

    res.status(202).json({ accepted: true });

    await syncEngine.handle({
      kind: 'wix_contact_changed',
      wixContactId: contactId,
      installationId: installation.id,
      origin: 'wix',
      correlationId: req.correlationId,
    });
  } catch (err) {
    next(err);
  }
});
