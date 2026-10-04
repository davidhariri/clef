import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { modelSettingsSchema } from './contract.js';
import type { Models } from './service.js';

export function registerModelRoutes(app: FastifyInstance, models: Models): void {
  app.get('/api/models', async () => models.catalog());
  app.put('/api/models/default', async (request) => {
    await models.saveDefaults(modelSettingsSchema.parse(request.body));
    return {
      ok: true,
    };
  });
  app.post('/api/models/ollama', async (request) => {
    const input = z
      .object({
        url: z.string().trim().min(1).max(2048),
      })
      .strict()
      .parse(request.body);
    await models.connectOllama(input.url);
    return {
      ok: true,
    };
  });
  app.post('/api/models/key', async (request) => {
    const input = z
      .object({
        provider: z.string(),
        key: z.string().min(1).max(8192),
      })
      .strict()
      .parse(request.body);
    await models.connectKey(input.provider, input.key);
    return {
      ok: true,
    };
  });
  app.post('/api/models/login', async (request) => {
    const input = z
      .object({
        provider: z.string(),
      })
      .strict()
      .parse(request.body);
    return models.login.start(input.provider);
  });
  app.get('/api/models/login/:id', async (request) =>
    models.login.state(
      z
        .object({
          id: z.string(),
        })
        .parse(request.params).id,
    ),
  );
  app.post('/api/models/login/:id', async (request) => {
    const { id } = z
      .object({
        id: z.string(),
      })
      .parse(request.params);
    const { answer } = z
      .object({
        answer: z.string().max(16384),
      })
      .strict()
      .parse(request.body);
    models.login.answer(id, answer);
    return {
      ok: true,
    };
  });
}
