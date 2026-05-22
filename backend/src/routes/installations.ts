import { Router } from 'express';
import { z } from 'zod';
import { requireInternalToken } from '../middleware/auth';
import * as installationsRepo from '../repositories/installations';
import * as tokensRepo from '../repositories/tokens';

export const installationsRouter = Router();

installationsRouter.use(requireInternalToken);

installationsRouter.get('/', async (_req, res, next) => {
  try {
    const installations = await installationsRepo.list();
    const augmented = await Promise.all(
      installations.map(async (i) => ({
        id: i.id,
        wix_instance_id: i.wix_instance_id,
        hubspot_portal_id: i.hubspot_portal_id,
        status: i.status,
        connected: !!(await tokensRepo.getByInstallationId(i.id)),
        updated_at: i.updated_at,
      })),
    );
    res.json({ installations: augmented });
  } catch (err) {
    next(err);
  }
});

installationsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const installation = await installationsRepo.getById(id);
    if (!installation) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const token = await tokensRepo.getByInstallationId(id);
    res.json({
      installation: {
        id: installation.id,
        wix_instance_id: installation.wix_instance_id,
        hubspot_portal_id: installation.hubspot_portal_id,
        status: installation.status,
        connected: !!token,
        token_expires_at: token?.expires_at ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});
