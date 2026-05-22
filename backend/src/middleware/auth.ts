import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { HttpError } from './errorHandler';
import { safeEqual } from '../crypto';

// Dashboard <-> backend traffic is gated by a single shared token. This keeps
// HubSpot tokens off the browser entirely. In production this would be
// replaced by a real session layer (e.g. a Wix-issued JWT verified against the
// instance), but the constraint that 'tokens are never exposed to the
// browser' is satisfied either way.
export function requireInternalToken(req: Request, _res: Response, next: NextFunction): void {
  const provided =
    req.header('x-internal-token') ??
    (req.header('authorization')?.startsWith('Bearer ')
      ? req.header('authorization')!.slice(7)
      : undefined);
  if (!provided || !safeEqual(provided, config.INTERNAL_API_TOKEN)) {
    return next(new HttpError(401, 'unauthorized'));
  }
  next();
}
