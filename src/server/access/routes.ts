import { hostname } from 'node:os';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Credentials } from '../credentials/index.js';
import type { Models } from '../models/index.js';
import { HttpError } from '../platform/http.js';
import { clientSchema } from './contract.js';
import type { Access } from './service.js';

export function registerAccessRoutes(
  app: FastifyInstance,
  access: Access,
  credentials: Credentials,
  models: Models,
) {
  const identities = new WeakMap<FastifyRequest, string>();
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const id = await access.authenticate(request.headers.authorization);
    identities.set(request, id);
    const unsubscribe = access.watch(id, () => reply.raw.destroy());
    reply.raw.once('close', unsubscribe);
    reply.raw.once('finish', unsubscribe);
    if (
      credentials.locked &&
      ![
        '/api/status',
        '/api/credentials/recover',
      ].includes(request.url)
    )
      throw new HttpError(423, 'Restore your encryption key first.');
  });
  const requireLocal = (request: FastifyRequest) => {
    if (identities.get(request) !== 'local')
      throw new HttpError(403, 'Manage client access from the server host.');
  };
  app.get('/api/status', async (request) => ({
    phase: credentials.locked ? 'locked' : (await models.catalog()).defaults ? 'ready' : 'connect',
    hostname: hostname(),
    local: identities.get(request) === 'local',
  }));
  app.get('/api/access/clients', async (request) => {
    requireLocal(request);
    return {
      clients: await access.list(),
    };
  });
  app.post('/api/access/clients', async (request) => {
    requireLocal(request);
    return access.issue(
      clientSchema
        .pick({
          name: true,
        })
        .strict()
        .parse(request.body).name,
    );
  });
  app.delete('/api/access/clients/:id', async (request) => {
    requireLocal(request);
    const { id } = z
      .object({
        id: z.string().uuid(),
      })
      .parse(request.params);
    await access.revoke(id);
    return {
      ok: true,
    };
  });
}
