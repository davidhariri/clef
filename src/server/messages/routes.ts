import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Agent } from '../agent/index.js';
import type { Models } from '../models/index.js';
import type { Permissions } from '../permissions/index.js';
import { openEvents } from '../platform/events.js';
import { HttpError } from '../platform/http.js';
import { sendInputSchema } from './contract.js';

export function registerMessageRoutes(
  app: FastifyInstance,
  agent: Agent,
  models: Models,
  permissions: Permissions,
): void {
  const idFrom = (params: unknown) =>
    z
      .object({
        id: z.string().max(80),
      })
      .parse(params).id;
  app.get('/api/conversations', async () => agent.list());
  app.post('/api/conversations', async () => agent.create(await models.defaults()));
  app.get('/api/conversations/:id', async (request) => {
    const id = idFrom(request.params);
    return {
      ...(await agent.snapshot(id)),
      permissions: permissions.pending(id),
    };
  });
  app.post('/api/conversations/:id/messages', async (request) => {
    const { text, requestId } = sendInputSchema.parse(request.body);
    try {
      await agent.send(idFrom(request.params), text, requestId);
    } catch {
      throw new HttpError(
        409,
        'The conversation is busy or unavailable. Wait or stop the current reply.',
      );
    }
    return {
      ok: true,
    };
  });
  app.post('/api/conversations/:id/stop', async (request) => {
    await agent.stop(idFrom(request.params));
    return {
      ok: true,
    };
  });
  app.get('/api/conversations/:id/events', async (request, reply) => {
    const id = idFrom(request.params);
    await agent.snapshot(id);
    const events = openEvents(reply);
    const stop = await agent.watch(id, async (snapshot) =>
      events.send('snapshot', {
        ...snapshot,
        permissions: permissions.pending(id),
      }),
    );
    try {
      await events.closed;
    } finally {
      await stop();
    }
  });
}
