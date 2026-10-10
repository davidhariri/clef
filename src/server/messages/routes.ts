import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Agent } from '../agent/index.js';
import type { Models } from '../models/index.js';
import { permissionChoiceSchema } from '../permissions/contract.js';
import type { Permissions } from '../permissions/index.js';
import { openEvents } from '../platform/events.js';
import { HttpError } from '../platform/http.js';
import { sendInputSchema } from './contract.js';

const conversationQuery = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
});

export function registerMessageRoutes(
  app: FastifyInstance,
  agent: Agent,
  models: Models,
  permissions: Permissions,
): void {
  const mainStreams = new Set<() => void>();
  let mainVersion = 0;
  app.get('/api/conversations', async (request) => {
    const { query } = z
      .object({
        query: z.string().max(200).default(''),
      })
      .parse(request.query);
    await agent.open(await models.defaults());
    return {
      conversations: await agent.history(query),
    };
  });
  app.post('/api/conversations', async () => {
    const conversation = await agent.createMain(await models.defaults());
    mainVersion++;
    for (const close of mainStreams) close();
    return conversation;
  });
  app.get('/api/conversation', async (request) => {
    const { id } = conversationQuery.parse(request.query);
    const conversation = await agent.open(await models.defaults(), id);

    return {
      ...(await agent.snapshot(conversation.id)),
      permissions: permissions.pending(conversation.id),
    };
  });
  app.post('/api/conversation/messages', async (request) => {
    const { text, requestId } = sendInputSchema.parse(request.body);
    const model = await models.defaults();
    const { id } = conversationQuery.parse(request.query);
    const conversation = await agent.open(model, id);
    try {
      await agent.send(text, requestId, model, conversation.id);
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
  app.post('/api/conversation/stop', async (request) => {
    const { id } = conversationQuery.parse(request.query);
    await agent.stop(id);

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
    const { id } = conversationQuery.parse(request.query);
    const { conversation } = await agent.snapshot(id);
    await permissions.decide(requestId, choice, conversation.id);
    return {
      ok: true,
    };
  });
  app.get('/api/conversation/events', async (request, reply) => {
    const version = mainVersion;
    const { id } = conversationQuery.parse(request.query);
    const conversation = await agent.open(await models.defaults(), id);
    const events = openEvents(reply);
    const close = () => {
      reply.raw.end();
    };
    if (id === undefined) mainStreams.add(close);
    const unsubscribe = permissions.subscribe(() => {
      void events.send('permissions', {
        permissions: permissions.pending(conversation.id),
      });
    });
    const stop = await agent.watch(
      async (snapshot) =>
        events.send('snapshot', {
          ...snapshot,
          permissions: permissions.pending(conversation.id),
        }),
      conversation.id,
    );
    try {
      if (id === undefined && version !== mainVersion) close();
      await events.closed;
    } finally {
      mainStreams.delete(close);
      unsubscribe();
      await stop();
    }
  });
}
