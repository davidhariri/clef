import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { testApplication } from '../../../tests/installation.js';

it('authenticates local access, issues revocable remote credentials, and retains them on restart', async () => {
  const app = await testApplication({
    connect: false,
  });
  const { home } = app;
  try {
    const token = app.localToken;
    const headers = {
      authorization: `Bearer ${token}`,
    };
    expect(
      (
        await app.server.inject({
          url: '/api/status',
          headers: {
            host: '127.0.0.1:3737',
          },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.server.inject({
          url: '/api/status',
          headers,
        })
      ).json(),
    ).toMatchObject({
      phase: 'connect',
    });
    const issued = await app.server.inject({
      method: 'POST',
      url: '/api/access/clients',
      headers,
      payload: {
        name: 'Laptop',
      },
    });
    expect(issued.statusCode).toBe(200);
    const client = issued.json();
    const remote = {
      authorization: `Bearer ${client.token}`,
    };
    expect(
      (
        await app.server.inject({
          url: '/api/models',
          headers: remote,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.server.inject({
          method: 'POST',
          url: '/api/access/clients',
          headers: remote,
          payload: {
            name: 'Other',
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.server.inject({
          url: '/api/models',
          headers: {
            ...headers,
            origin: 'https://evil.example',
          },
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.server.inject('/')).statusCode).toBe(404);
    expect((await stat(join(home, 'secrets', 'local-token'))).mode & 0o777).toBe(0o600);
    expect(
      (await readFile(join(home, 'state', 'clef.sqlite'))).includes(Buffer.from(client.token)),
    ).toBe(false);
    await app.restart();
    expect(app.localToken).toBe(token);
    expect(
      (
        await app.server.inject({
          url: '/api/models',
          headers: remote,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.server.inject({
          method: 'DELETE',
          url: `/api/access/clients/${client.id}`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.server.inject({
          url: '/api/models',
          headers: remote,
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await app.dispose();
  }
});
