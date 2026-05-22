import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../logger';
import { HttpError } from '../middleware/errorHandler';
import {
  exchangeCodeForTokens,
  fetchTokenMetadata,
  loadToken,
} from '../services/tokenService';
import { revokeRefreshToken } from '../services/hubspotClient';
import * as installationsRepo from '../repositories/installations';
import * as tokensRepo from '../repositories/tokens';
import { safeEqual } from '../crypto';

export const authRouter = Router();

// In-memory store of OAuth `state` values. It binds the install request to
// the callback so a CSRF cannot trick us into accepting a code from someone
// else's HubSpot. Five-minute ttl is more than enough for the redirect.
const stateStore = new Map<string, { wixInstanceId: string; expiresAt: number }>();
function setState(value: string, wixInstanceId: string): void {
  stateStore.set(value, { wixInstanceId, expiresAt: Date.now() + 5 * 60 * 1000 });
}
function takeState(value: string): { wixInstanceId: string } | null {
  const entry = stateStore.get(value);
  if (!entry) return null;
  stateStore.delete(value);
  if (entry.expiresAt < Date.now()) return null;
  return { wixInstanceId: entry.wixInstanceId };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of stateStore.entries()) if (v.expiresAt < now) stateStore.delete(k);
}, 60_000).unref();

const installQuery = z.object({
  wix_instance_id: z.string().min(1),
});

authRouter.get('/hubspot/install', (req, res, next) => {
  try {
    if (!config.HUBSPOT_CLIENT_ID || !config.HUBSPOT_CLIENT_SECRET) {
      throw new HttpError(503, 'hubspot_not_configured', {
        hint: 'Set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET in .env',
      });
    }
    const { wix_instance_id } = installQuery.parse(req.query);
    const state = crypto.randomBytes(16).toString('hex');
    setState(state, wix_instance_id);

    const url = new URL(`${config.HUBSPOT_AUTH_BASE_URL}/oauth/authorize`);
    url.searchParams.set('client_id', config.HUBSPOT_CLIENT_ID);
    url.searchParams.set('redirect_uri', config.HUBSPOT_REDIRECT_URI);
    url.searchParams.set('scope', config.hubspotScopes.join(' '));
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  } catch (err) {
    next(err);
  }
});

const callbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

authRouter.get('/hubspot/callback', async (req, res, next) => {
  try {
    const params = callbackQuery.parse(req.query);
    if (params.error) {
      throw new HttpError(400, 'hubspot_oauth_error', { error: params.error, description: params.error_description });
    }
    if (!params.code || !params.state) throw new HttpError(400, 'missing_code_or_state');

    const state = takeState(params.state);
    if (!state) throw new HttpError(400, 'invalid_or_expired_state');

    const tokens = await exchangeCodeForTokens(params.code);
    const meta = await fetchTokenMetadata(tokens.accessToken);

    const installation = await installationsRepo.upsert({
      wixInstanceId: state.wixInstanceId,
      hubspotPortalId: meta.portalId,
      status: 'connected',
    });

    await tokensRepo.upsert({
      installationId: installation.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      portalId: meta.portalId,
    });

    logger.info({ installationId: installation.id, portalId: meta.portalId }, 'hubspot connected');

    const dest = new URL(config.DASHBOARD_URL);
    dest.searchParams.set('installation', installation.id);
    dest.searchParams.set('connected', '1');
    res.redirect(dest.toString());
  } catch (err) {
    next(err);
  }
});

const disconnectBody = z.object({
  installation_id: z.string().uuid(),
});

// Requires the internal token, same as the rest of the dashboard surface.
authRouter.post('/hubspot/disconnect', async (req, res, next) => {
  try {
    const provided = req.header('x-internal-token');
    if (!provided || !safeEqual(provided, config.INTERNAL_API_TOKEN)) {
      throw new HttpError(401, 'unauthorized');
    }
    const { installation_id } = disconnectBody.parse(req.body);
    const token = await loadToken(installation_id);
    if (token) await revokeRefreshToken(token.refresh_token);
    await tokensRepo.deleteByInstallationId(installation_id);
    await installationsRepo.markDisconnected(installation_id);
    res.json({ status: 'disconnected' });
  } catch (err) {
    next(err);
  }
});
