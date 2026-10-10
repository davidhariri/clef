import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { testApplication } from '../../../tests/installation.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('authenticates file settings, confirms global access, and persists canonical grants', async () => {
  const clef = await testApplication();
  const external = await mkdtemp(join(tmpdir(), 'clef-grant-'));
  cleanups.push(async () => {
    await clef.dispose();
    await rm(external, {
      recursive: true,
      force: true,
    });
  });
  const endpoint = '/api/files/access';
  expect(
    (
      await clef.server.inject({
        url: endpoint,
        headers: {
          host: clef.headers.host,
        },
      })
    ).statusCode,
  ).toBe(401);
  const response = await clef.server.inject({
    url: endpoint,
    headers: clef.headers,
  });
  expect(response.statusCode).toBe(200);
  const before = response.json();
  const payload = {
    revision: before.revision,
    policy: {
      global: true,
      directories: [
        ...before.policy.directories,
        {
          path: external,
          access: 'read',
        },
      ],
    },
  };
  expect(
    (
      await clef.server.inject({
        method: 'PUT',
        url: endpoint,
        headers: {
          host: clef.headers.host,
        },
        payload,
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await clef.server.inject({
        method: 'PUT',
        url: endpoint,
        headers: clef.headers,
        payload,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await clef.server.inject({
        method: 'PUT',
        url: endpoint,
        headers: {
          ...clef.headers,
          origin: 'https://foreign.example',
        },
        payload: {
          ...payload,
          confirmGlobal: true,
        },
      })
    ).statusCode,
  ).toBe(403);
  const saved = await clef.server.inject({
    method: 'PUT',
    url: endpoint,
    headers: clef.headers,
    payload: {
      ...payload,
      confirmGlobal: true,
    },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json().policy).toMatchObject({
    global: true,
    directories: expect.arrayContaining([
      {
        path: await realpath(external),
        access: 'read',
      },
    ]),
  });
  await clef.restart();
  expect(
    (
      await clef.server.inject({
        url: endpoint,
        headers: clef.headers,
      })
    ).json(),
  ).toEqual(saved.json());
  expect(
    (
      await clef.server.inject({
        method: 'PUT',
        url: endpoint,
        headers: clef.headers,
        payload: {
          ...payload,
          confirmGlobal: true,
        },
      })
    ).statusCode,
  ).toBe(409);
});
