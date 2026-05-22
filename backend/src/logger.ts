import pino from 'pino';
import { config } from './config';

// Paths in the log object that must never leak to the log sink. Pino's redact
// option replaces matching values with '[Redacted]'. Wildcards cover nested
// shapes we cannot fully predict (e.g. HubSpot or Wix API responses).
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-internal-token"]',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.access_token',
  '*.refresh_token',
  '*.accessToken',
  '*.refreshToken',
  '*.password',
  '*.email',
  '*.phone',
  '*.firstname',
  '*.lastname',
  'body.email',
  'body.phone',
  'body.firstname',
  'body.lastname',
];

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: REDACT_PATHS,
    censor: '[Redacted]',
    remove: false,
  },
  base: { service: 'wix-hubspot-sync' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
