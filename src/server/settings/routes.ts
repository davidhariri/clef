import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
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
      })
      .parse(request.body);
    const next = await settings.validate(input.source);
    return settings.update(input.revision, (document) => Object.assign(document, next));
  });
}
