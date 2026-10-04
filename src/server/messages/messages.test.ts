import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { testApplication } from '../../../tests/installation.js';
import { conversationSchema, snapshotSchema } from './contract.js';

it('binds permission decisions to an authenticated origin and the pending conversation', async () => {
  const clef = await testApplication();
  try {
    const conversation = conversationSchema.parse(
      (
        await clef.server.inject({
          method: 'POST',
          url: '/api/conversations',
          headers: clef.headers,
        })
      ).json(),
    );
    const submitted = await clef.server.inject({
      method: 'POST',
      url: `/api/conversations/${conversation.id}/messages`,
      headers: clef.headers,
      payload: {
        text: 'configure switch',
        requestId: randomUUID(),
      },
    });
    expect(submitted.statusCode).toBe(200);
    const snapshot = async () =>
      snapshotSchema.parse(
        (
          await clef.server.inject({
            url: `/api/conversations/${conversation.id}`,
            headers: clef.headers,
          })
        ).json(),
      );
    await vi.waitFor(async () => expect((await snapshot()).permissions).toHaveLength(1));
    const pending = (await snapshot()).permissions;
    const endpoint = `/api/conversations/${conversation.id}/permissions/${pending[0]?.id}`;
    const unauthenticated = await clef.server.inject({
      method: 'POST',
      url: endpoint,
      headers: {
        host: clef.headers.host,
      },
      payload: {
        choice: 'once',
      },
    });
    expect(unauthenticated.statusCode).toBe(401);
    const foreign = await clef.server.inject({
      method: 'POST',
      url: endpoint,
      headers: {
        ...clef.headers,
        origin: 'https://untrusted.example',
      },
      payload: {
        choice: 'once',
      },
    });
    expect(foreign.statusCode).toBe(403);
    const other = conversationSchema.parse(
      (
        await clef.server.inject({
          method: 'POST',
          url: '/api/conversations',
          headers: clef.headers,
        })
      ).json(),
    );
    const mismatched = await clef.server.inject({
      method: 'POST',
      url: `/api/conversations/${other.id}/permissions/${pending[0]?.id}`,
      headers: clef.headers,
      payload: {
        choice: 'once',
      },
    });
    expect(mismatched.statusCode).toBe(409);
    expect((await snapshot()).permissions).toEqual(pending);
    expect(
      (
        await clef.server.inject({
          url: '/api/models',
          headers: clef.headers,
        })
      ).json().defaults.modelId,
    ).toBe('test-model');

    const denied = await clef.server.inject({
      method: 'POST',
      url: endpoint,
      headers: clef.headers,
      payload: {
        choice: 'deny',
      },
    });
    expect(denied.statusCode).toBe(200);
    const repeated = await clef.server.inject({
      method: 'POST',
      url: endpoint,
      headers: clef.headers,
      payload: {
        choice: 'once',
      },
    });
    expect(repeated.statusCode).toBe(409);
    await vi.waitFor(async () => expect((await snapshot()).busy).toBe(false));
  } finally {
    await clef.dispose();
  }
});
