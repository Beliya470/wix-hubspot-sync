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
// We mount raw body parsing scoped to these handlers so that the rest of the
// app continues to use express.json().
const rawJson = raw({ type: 'application/json', limit: '1mb' });

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
// with the public key configured for the app (WIX_WEBHOOK_PUBLIC_KEY). When
// the JWT is the request body itself, we decode it and return the inner
// payload; the route handler reads `instanceId` and `data.contactId` from it.
function verifyAndDecodeWixWebhook(raw: Buffer): { payload: unknown } | null {
  if (!config.WIX_WEBHOOK_PUBLIC_KEY) {
    logger.warn('WIX_WEBHOOK_PUBLIC_KEY not set; rejecting wix webhook');
    return null;
  }
  const token = raw.toString('utf8').trim();
  // The Wix webhook body is the JWT itself, three dot-separated base64url
  // segments. Anything that does not match that shape is rejected before we
  // hand it to the JWT library.
  if (token.split('.').length !== 3) return null;
  try {
    const decoded = jwt.verify(token, config.WIX_WEBHOOK_PUBLIC_KEY, {
      algorithms: ['RS256'],
    });
    // Wix wraps the actual event in a `data` field that is itself a JSON
    // string. Unwrap one level so the route handler can read the contact id
    // and instance id without knowing about the wrapping.
    if (typeof decoded === 'object' && decoded !== null && 'data' in decoded) {
      const inner = (decoded as { data: unknown }).data;
      if (typeof inner === 'string') {
        try {
          return { payload: JSON.parse(inner) };
        } catch {
          return { payload: inner };
        }
      }
      return { payload: inner };
    }
    return { payload: decoded };
  } catch (err) {
    logger.warn({ err }, 'wix webhook jwt verification failed');
    return null;
  }
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

const wixPayload = z.object({
  instanceId: z.string().optional(),
  identityType: z.string().optional(),
  identityId: z.string().optional(),
  eventType: z.string().optional(),
  actionEvent: z.object({
    body: z.object({
      contact: z.object({ id: z.string() }).passthrough().optional(),
      contactId: z.string().optional(),
    }).passthrough(),
  }).passthrough().optional(),
  entity: z.union([
    z.string(),
    z.object({
      _id: z.string().optional(),
      id: z.string().optional(),
    }).passthrough(),
  ]).optional(),
  data: z
    .object({
      contactId: z.string().optional(),
      contact: z.object({ id: z.string() }).optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();

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
    const parsed = wixPayload.parse(verified.payload);

    const wixInstanceId = parsed.instanceId;
    if (!wixInstanceId) throw new HttpError(400, 'missing_instance_id');

    const installation = await installationsRepo.getByWixInstanceId(wixInstanceId);
    if (!installation) {
      throw new HttpError(404, 'unknown_installation', { wixInstanceId });
    }

    let contactId: string | undefined =
      parsed.actionEvent?.body?.contact?.id ??
      parsed.actionEvent?.body?.contactId ??
      parsed.data?.contactId ??
      parsed.data?.contact?.id;
    if (!contactId && typeof parsed.entity === 'string') {
      try {
        const entity = JSON.parse(parsed.entity) as { id?: string; _id?: string };
        contactId = entity.id ?? entity._id;
      } catch {
        // ignore parse errors; we'll fall through to validation
      }
    } else if (!contactId && parsed.entity && typeof parsed.entity === 'object') {
      contactId = parsed.entity.id ?? parsed.entity._id;
    }
    if (!contactId) throw new HttpError(400, 'missing_contact_id');

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
