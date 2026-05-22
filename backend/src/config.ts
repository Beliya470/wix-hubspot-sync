import 'dotenv/config';
import { z } from 'zod';
import path from 'path';
import dotenv from 'dotenv';

// We allow a root .env to feed both backend and frontend.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
  DASHBOARD_URL: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),

  // HubSpot creds are required for the OAuth flow but not for the rest of
  // the backend to come up. Routes that need them throw a clear error if
  // they're absent at request time.
  HUBSPOT_CLIENT_ID: z.string().default(''),
  HUBSPOT_CLIENT_SECRET: z.string().default(''),
  HUBSPOT_APP_ID: z.string().optional(),
  HUBSPOT_REDIRECT_URI: z.string().url().default('http://localhost:3000/auth/hubspot/callback'),
  HUBSPOT_SCOPES: z
    .string()
    .default('crm.objects.contacts.read crm.objects.contacts.write crm.schemas.contacts.read oauth'),
  // EU portals use app-eu1.hubspot.com for the authorize endpoint. The token,
  // refresh, and CRM API calls still go to api.hubapi.com regardless of region.
  HUBSPOT_AUTH_BASE_URL: z.string().url().default('https://app.hubspot.com'),
  HUBSPOT_WEBHOOK_SECRET: z.string().optional(),

  WIX_APP_ID: z.string().optional(),
  WIX_APP_SECRET: z.string().optional(),
  WIX_WEBHOOK_SECRET: z.string().optional(),

  INTERNAL_API_TOKEN: z.string().min(16, 'INTERNAL_API_TOKEN must be at least 16 chars'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    // eslint-disable-next-line no-console
    console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = Object.freeze({
  ...parsed.data,
  hubspotScopes: parsed.data.HUBSPOT_SCOPES.split(/\s+/).filter(Boolean),
});

export type AppConfig = typeof config;
