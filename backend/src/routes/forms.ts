import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../logger';
import { HttpError } from '../middleware/errorHandler';
import * as installationsRepo from '../repositories/installations';
import * as syncLog from '../repositories/syncLog';
import * as hubspot from '../services/hubspotClient';
import * as contactMapRepo from '../repositories/contactMap';
import { ensureCustomProperties } from '../services/propertyBootstrap';
import { stableHash } from '../crypto';

export const formsRouter = Router();

// UTM-style attribution fields. They map 1:1 to HubSpot contact properties of
// the same name; HubSpot exposes these out of the box.
const utmSchema = z.object({
  utm_source: z.string().max(255).optional(),
  utm_medium: z.string().max(255).optional(),
  utm_campaign: z.string().max(255).optional(),
  utm_term: z.string().max(255).optional(),
  utm_content: z.string().max(255).optional(),
});

const submissionBody = z.object({
  wix_instance_id: z.string().min(1),
  email: z.string().email(),
  first_name: z.string().max(255).optional(),
  last_name: z.string().max(255).optional(),
  phone: z.string().max(64).optional(),
  company: z.string().max(255).optional(),
  custom_fields: z.record(z.string(), z.string()).optional(),
  utm: utmSchema.optional(),
  // page_url and referrer are arbitrary strings captured from the visitor's
  // browser. Browsers and Wix forms do not guarantee RFC-3986 URLs, so we
  // only enforce a sensible length cap.
  page_url: z.string().max(2048).optional(),
  referrer: z.string().max(2048).optional(),
  submitted_at: z.string().datetime().optional(),
  wix_contact_id: z.string().optional(),
});

formsRouter.post('/submit', async (req, res, next) => {
  try {
    const body = submissionBody.parse(req.body);
    const installation = await installationsRepo.getByWixInstanceId(body.wix_instance_id);
    if (!installation) throw new HttpError(404, 'installation_not_found');

    // Best-effort: make sure the custom properties this route writes to
    // exist on the HubSpot portal. Falls back to filtering on the client
    // side if the app is missing crm.schemas.contacts.write.
    await ensureCustomProperties(installation.id);

    const properties: Record<string, string> = {
      email: body.email,
    };
    if (body.first_name) properties.firstname = body.first_name;
    if (body.last_name) properties.lastname = body.last_name;
    if (body.phone) properties.phone = body.phone;
    if (body.company) properties.company = body.company;
    if (body.utm?.utm_source) properties.utm_source = body.utm.utm_source;
    if (body.utm?.utm_medium) properties.utm_medium = body.utm.utm_medium;
    if (body.utm?.utm_campaign) properties.utm_campaign = body.utm.utm_campaign;
    if (body.utm?.utm_term) properties.utm_term = body.utm.utm_term;
    if (body.utm?.utm_content) properties.utm_content = body.utm.utm_content;
    if (body.page_url) properties.last_form_page_url = body.page_url;
    if (body.referrer) properties.last_form_referrer = body.referrer;
    properties.last_form_submitted_at = body.submitted_at ?? new Date().toISOString();
    if (body.custom_fields) {
      for (const [k, v] of Object.entries(body.custom_fields)) properties[k] = v;
    }

    // Mark fresh leads as NEW so they show up correctly in HubSpot's lead
    // pipeline. We only apply this on create so a repeat submission does not
    // reset a lead that has already advanced through the funnel.
    const { contact, created } = await hubspot.upsertContactByEmail(
      installation.id,
      body.email,
      properties,
      { hs_lead_status: 'NEW', lifecyclestage: 'lead' },
    );

    if (body.wix_contact_id) {
      await contactMapRepo.upsert({
        installationId: installation.id,
        wixContactId: body.wix_contact_id,
        hubspotContactId: contact.id,
      });
    }

    await syncLog.append({
      installationId: installation.id,
      origin: 'form',
      direction: 'wix_to_hubspot',
      correlationId: req.correlationId,
      wixContactId: body.wix_contact_id,
      hubspotContactId: contact.id,
      status: 'succeeded',
      payloadHash: stableHash(properties),
    });

    logger.info(
      { installationId: installation.id, contactId: contact.id, created },
      'form submission synced',
    );

    res.status(created ? 201 : 200).json({ contact_id: contact.id, created });
  } catch (err) {
    next(err);
  }
});
