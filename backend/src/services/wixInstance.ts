import crypto from 'crypto';
import { config } from '../config';
import { HttpError } from '../middleware/errorHandler';

// Wix passes a signed `instance` parameter to the dashboard iframe on every
// load. The token has two segments separated by a dot:
//
//   <base64url-signature>.<base64url-payload>
//
// The signature is an HMAC-SHA256 of the payload keyed with the app secret.
// The payload is base64-url-encoded JSON with the instance id, app id, user
// id, permissions, and expiration date.
export interface WixInstanceClaims {
  instanceId: string;
  appDefId: string;
  signDate: string;
  uid: string;
  permissions: string;
  demoMode: boolean;
  siteOwnerId: string;
  siteMemberId?: string;
  expirationDate: string;
  loginAccountId?: string;
  aor?: boolean;
  sid?: string;
  scd?: string;
  acd?: string;
}

function base64UrlToBuffer(input: string): Buffer {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function decodeAndVerifyWixInstance(instance: string): WixInstanceClaims {
  if (!config.WIX_APP_SECRET) {
    throw new HttpError(500, 'wix_app_secret_missing', {
      hint: 'Set WIX_APP_SECRET in the backend environment before mounting the Wix app.',
    });
  }
  const dot = instance.indexOf('.');
  if (dot <= 0 || dot === instance.length - 1) {
    throw new HttpError(401, 'invalid_instance_format');
  }
  const signature = instance.slice(0, dot);
  const payloadEncoded = instance.slice(dot + 1);

  const expectedSignature = crypto
    .createHmac('sha256', config.WIX_APP_SECRET)
    .update(payloadEncoded)
    .digest('base64url');

  if (!constantTimeEqual(signature, expectedSignature)) {
    throw new HttpError(401, 'invalid_instance_signature');
  }

  let claims: WixInstanceClaims;
  try {
    claims = JSON.parse(base64UrlToBuffer(payloadEncoded).toString('utf8')) as WixInstanceClaims;
  } catch {
    throw new HttpError(401, 'invalid_instance_payload');
  }

  if (claims.appDefId !== config.WIX_APP_ID) {
    throw new HttpError(401, 'instance_app_id_mismatch', {
      expected: config.WIX_APP_ID,
      received: claims.appDefId,
    });
  }

  const expiresAt = Date.parse(claims.expirationDate);
  if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
    throw new HttpError(401, 'instance_expired', { expired_at: claims.expirationDate });
  }

  return claims;
}
