import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Credentials } from './service.js';

export function registerCredentialRoutes(
  app: FastifyInstance,
  credentials: Pick<Credentials, 'recover'>,
): void {
  app.post('/api/credentials/recover', async (request) => {
    const { key } = z
      .object({
        key: z.string().regex(/^[a-f0-9]{64}$/i),
      })
      .strict()
      .parse(request.body);
    await credentials.recover(key);
    return {
      ok: true,
    };
  });
}
