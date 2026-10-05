import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requiresGlobalConfirmation } from '../permissions/contract.js';
import { HttpError } from '../platform/http.js';
import { revisionSchema } from './contract.js';
import type { Settings } from './service.js';

const sourceSchema = z.strictObject({
  source: z.string().max(65536),
});

export function registerSettingsRoutes(app: FastifyInstance, settings: Settings): void {
  app.get('/api/settings', async () => settings.view());
  app.post('/api/settings/validate', async (request) => {
    await settings.validate(sourceSchema.parse(request.body).source);
    return {
      ok: true,
    };
  });
  app.put('/api/settings', async (request) => {
    const input = sourceSchema
      .extend({
        revision: revisionSchema,
        confirmGlobal: z.boolean().default(false),
      })
      .parse(request.body);
    const next = await settings.validate(input.source);
    return settings.update(input.revision, (document) => {
      if (requiresGlobalConfirmation(document.files, next.files, input.confirmGlobal))
        throw new HttpError(400, 'Confirm global host file access explicitly.');
      Object.assign(document, next);
    });
  });
}
