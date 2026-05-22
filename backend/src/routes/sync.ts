import { Router } from 'express';
import { z } from 'zod';
import { requireInternalToken } from '../middleware/auth';
import * as syncEngine from '../services/syncEngine';
import * as syncLog from '../repositories/syncLog';

export const syncRouter = Router();

syncRouter.use(requireInternalToken);

const triggerBody = z.discriminatedUnion('direction', [
  z.object({
    installation_id: z.string().uuid(),
    direction: z.literal('wix_to_hubspot'),
    wix_contact_id: z.string().min(1),
  }),
  z.object({
    installation_id: z.string().uuid(),
    direction: z.literal('hubspot_to_wix'),
    hubspot_contact_id: z.string().min(1),
  }),
]);

syncRouter.post('/trigger', async (req, res, next) => {
  try {
    const body = triggerBody.parse(req.body);
    const result = body.direction === 'wix_to_hubspot'
      ? await syncEngine.handle({
          kind: 'wix_contact_changed',
          installationId: body.installation_id,
          wixContactId: body.wix_contact_id,
          origin: 'manual',
          correlationId: req.correlationId,
        })
      : await syncEngine.handle({
          kind: 'hubspot_contact_changed',
          installationId: body.installation_id,
          hubspotContactId: body.hubspot_contact_id,
          origin: 'manual',
          correlationId: req.correlationId,
        });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

syncRouter.get('/log/:installationId', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.installationId);
    const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit ?? '50');
    const rows = await syncLog.listForInstallation(id, limit);
    res.json({ entries: rows });
  } catch (err) {
    next(err);
  }
});
