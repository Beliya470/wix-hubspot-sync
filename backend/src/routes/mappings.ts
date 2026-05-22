import { Router } from 'express';
import { z } from 'zod';
import { requireInternalToken } from '../middleware/auth';
import { HttpError } from '../middleware/errorHandler';
import * as mappingsRepo from '../repositories/mappings';
import * as hubspot from '../services/hubspotClient';
import { SUPPORTED_TRANSFORMS } from '../services/transforms';

export const mappingsRouter = Router();

mappingsRouter.use(requireInternalToken);

// Wix's contact info shape is well-defined; we expose the normalised flat
// keys the sync engine understands.
const WIX_FIELDS = ['email', 'firstName', 'lastName', 'phone', 'company'] as const;

mappingsRouter.get('/options', async (req, res, next) => {
  try {
    const installationId = z.string().uuid().parse(req.query.installation_id);
    let hubspotProperties: string[] = [];
    try {
      hubspotProperties = await hubspot.listContactProperties(installationId);
    } catch (err) {
      // Surface a partial response when HubSpot is unreachable rather than
      // breaking the dashboard load.
      hubspotProperties = ['email', 'firstname', 'lastname', 'phone', 'company'];
    }
    res.json({
      wix_fields: WIX_FIELDS,
      hubspot_properties: hubspotProperties,
      transforms: SUPPORTED_TRANSFORMS,
      directions: ['wix_to_hubspot', 'hubspot_to_wix', 'bidirectional'],
    });
  } catch (err) {
    next(err);
  }
});

mappingsRouter.get('/:installationId', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.installationId);
    const rows = await mappingsRepo.list(id);
    res.json({ mappings: rows });
  } catch (err) {
    next(err);
  }
});

const mappingItem = z.object({
  wix_field: z.string().min(1),
  hubspot_property: z.string().min(1),
  direction: z.enum(['wix_to_hubspot', 'hubspot_to_wix', 'bidirectional']),
  transform: z.enum(['trim', 'lowercase']).nullable(),
});

const putBody = z.object({
  installation_id: z.string().uuid(),
  mappings: z.array(mappingItem),
});

mappingsRouter.put('/', async (req, res, next) => {
  try {
    const body = putBody.parse(req.body);

    // Duplicate validation:
    //   - the same wix_field cannot appear twice
    //   - the same hubspot_property cannot appear twice unless the duplicate
    //     uses an opposite direction (so a property can drive both inbound and
    //     outbound sync via two rows).
    const wixSeen = new Set<string>();
    const hubspotBy: Record<string, string[]> = {};
    for (const m of body.mappings) {
      if (wixSeen.has(m.wix_field)) {
        throw new HttpError(400, 'duplicate_wix_field', { wix_field: m.wix_field });
      }
      wixSeen.add(m.wix_field);
      (hubspotBy[m.hubspot_property] ??= []).push(m.direction);
    }
    for (const [prop, dirs] of Object.entries(hubspotBy)) {
      if (dirs.length > 1) {
        const set = new Set(dirs);
        if (set.has('bidirectional') || dirs.length > 2 ||
            (set.has('wix_to_hubspot') && !set.has('hubspot_to_wix')) ||
            (set.has('hubspot_to_wix') && !set.has('wix_to_hubspot'))) {
          throw new HttpError(400, 'duplicate_hubspot_property', { hubspot_property: prop });
        }
      }
    }

    await mappingsRepo.replaceAll(body.installation_id, body.mappings);
    res.json({ status: 'saved', count: body.mappings.length });
  } catch (err) {
    next(err);
  }
});
