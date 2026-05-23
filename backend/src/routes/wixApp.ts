import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../logger';
import * as installationsRepo from '../repositories/installations';
import { decodeAndVerifyWixInstance } from '../services/wixInstance';

export const wixAppRouter = Router();

const installBody = z.object({
  instance: z.string().min(1),
});

// Called by the dashboard immediately after Wix loads it in an iframe. The
// `instance` value is the signed token Wix puts on the URL; we verify it,
// extract the instance id, and upsert an installation row. No auth header
// required because the signed token IS the auth.
wixAppRouter.post('/install', async (req, res, next) => {
  try {
    const { instance } = installBody.parse(req.body);
    const claims = decodeAndVerifyWixInstance(instance);

    const installation = await installationsRepo.upsert({
      wixInstanceId: claims.instanceId,
      status: 'wix_connected',
    });

    logger.info(
      {
        installationId: installation.id,
        wixInstanceId: claims.instanceId,
        permissions: claims.permissions,
        demoMode: claims.demoMode,
      },
      'wix install captured',
    );

    res.json({
      installation_id: installation.id,
      wix_instance_id: claims.instanceId,
      hubspot_connected: !!installation.hubspot_portal_id,
      permissions: claims.permissions,
    });
  } catch (err) {
    next(err);
  }
});
