import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import * as tokensRepo from '../repositories/tokens';
import { HubspotTokenRecord } from '../types';

const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';

// HubSpot tokens have a short ttl. We treat anything within this window as
// effectively expired so that a request never races a 401.
const REFRESH_BUFFER_MS = 60_000;

interface HubspotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.HUBSPOT_CLIENT_ID,
    client_secret: config.HUBSPOT_CLIENT_SECRET,
    redirect_uri: config.HUBSPOT_REDIRECT_URI,
    code,
  });
  const { data } = await axios.post<HubspotTokenResponse>(HUBSPOT_TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return tokenResponseToFields(data);
}

export async function refreshTokens(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.HUBSPOT_CLIENT_ID,
    client_secret: config.HUBSPOT_CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  const { data } = await axios.post<HubspotTokenResponse>(HUBSPOT_TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return tokenResponseToFields(data);
}

// Fetches HubSpot account info given a fresh access token. We use this on the
// install callback to record which portal the user actually connected.
export async function fetchTokenMetadata(accessToken: string): Promise<{ portalId: string }> {
  const { data } = await axios.get<{ hub_id: number }>(
    `https://api.hubapi.com/oauth/v1/access-tokens/${accessToken}`,
  );
  return { portalId: String(data.hub_id) };
}

export async function getValidAccessToken(installationId: string): Promise<string> {
  const current = await tokensRepo.getByInstallationId(installationId);
  if (!current) {
    throw new Error(`no hubspot tokens for installation ${installationId}`);
  }
  if (current.expires_at.getTime() - Date.now() > REFRESH_BUFFER_MS) {
    return current.access_token;
  }
  logger.info({ installationId }, 'refreshing expired hubspot access token');
  const refreshed = await refreshTokens(current.refresh_token);
  await tokensRepo.upsert({
    installationId,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    portalId: current.portal_id,
  });
  return refreshed.accessToken;
}

export async function loadToken(installationId: string): Promise<HubspotTokenRecord | null> {
  return tokensRepo.getByInstallationId(installationId);
}

function tokenResponseToFields(data: HubspotTokenResponse) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}
