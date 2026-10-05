import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Agent } from '../agent/index.js';
import type { Models } from '../models/index.js';
import { permissionChoiceSchema } from '../permissions/contract.js';
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
  app.get('/api/conversation', async () => {
    const conversation = await agent.open(await models.defaults());

    return {
      ...(await agent.snapshot()),
      permissions: permissions.pending(conversation.id),
    };
  });
  app.post('/api/conversation/messages', async (request) => {
    const input = sendInputSchema.parse(request.body);
    const model = await models.defaults();
    await agent.open(model);
    try {
      await agent.send(input, model);
    } catch (error) {
      if (error instanceof HttpError) throw error;

      throw new HttpError(
        409,
        'The conversation is busy or unavailable. Wait or stop the current reply.',
      );
    }

    return {
      ok: true,
    };
  });
  app.post('/api/conversation/stop', async () => {
    await agent.stop();

    return {
      ok: true,
    };
  });
  app.post('/api/conversation/permissions/:requestId', async (request) => {
    const { requestId } = z
      .object({
        requestId: z.string().uuid(),
      })
      .parse(request.params);
    const { choice } = z
      .strictObject({
        choice: permissionChoiceSchema,
      })
      .parse(request.body);
    const { conversation } = await agent.snapshot();
    await permissions.decide(requestId, choice, conversation.id);
    return {
      ok: true,
    };
  });
  app.get('/api/conversation/events', async (_request, reply) => {
    const conversation = await agent.open(await models.defaults());
    const events = openEvents(reply);
    const unsubscribe = permissions.subscribe(() => {
      void events.send('permissions', {
        permissions: permissions.pending(conversation.id),
      });
    });
    const stop = await agent.watch(async (snapshot) =>
      events.send('snapshot', {
        ...snapshot,
        permissions: permissions.pending(conversation.id),
      }),
    );
    try {
      await events.closed;
    } finally {
      unsubscribe();
      await stop();
    }
  });
}
