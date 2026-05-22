import crypto from 'crypto';
import { config } from './config';

// AES-256-GCM gives us authenticated encryption: tampering with the
// ciphertext fails the auth tag check on decrypt instead of returning garbage.
const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, the GCM-recommended IV length.

const key = Buffer.from(config.ENCRYPTION_KEY, 'hex');

export interface EncryptedValue {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

export function encrypt(plaintext: string): EncryptedValue {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decrypt(value: EncryptedValue): string {
  const iv = Buffer.from(value.iv, 'base64');
  const tag = Buffer.from(value.tag, 'base64');
  const ciphertext = Buffer.from(value.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString('utf8');
}

// Constant-time HMAC-SHA256 helper used for webhook signature verification.
export function hmacSha256Base64(secret: string, payload: string | Buffer): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Stable hash of a JS value, used as an idempotency key in sync_log.
export function stableHash(value: unknown): string {
  const canonical = JSON.stringify(sortKeys(value));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
  return out;
}
