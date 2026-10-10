import { expect, it } from 'vitest';
import { testApplication } from '../../tests/installation.js';
import { issuedClientSchema, okSchema, statusSchema } from '../server/access/contract.js';
import { ClefClient } from './index.js';

it('rejects insecure remote endpoints and URL credentials', () => {
  for (const url of [
    'http://100.100.1.2:3737',
    'http://server.tailnet.ts.net',
    'https://user:secret@example.com',
    'https://example.com/path',
  ]) {
    expect(() => new ClefClient(url, 'token')).toThrow();
  }
  expect(() => new ClefClient('https://server.tailnet.ts.net', 'token')).not.toThrow();
  expect(() => new ClefClient('http://127.0.0.1:3737', 'token')).not.toThrow();
});

it('uses authenticated HTTP for the running server', async () => {
  const app = await testApplication();
  try {
    const url = await app.server.listen({
      host: '127.0.0.1',
      port: 0,
    });
    const client = new ClefClient(url, app.headers.authorization.slice(7));
    expect(await client.request('/api/status', statusSchema)).toMatchObject({
      phase: 'ready',
    });
    const issued = await client.request('/api/access/clients', issuedClientSchema, {
      name: 'Remote',
    });
    await expect(
      client.request(`/api/access/clients/${issued.id}`, okSchema, undefined, 'DELETE'),
    ).resolves.toEqual({
      ok: true,
    });
    await expect(
      new ClefClient(url, 'invalid').request('/api/status', statusSchema),
    ).rejects.toThrow('token');
  } finally {
    await app.dispose();
  }
});
