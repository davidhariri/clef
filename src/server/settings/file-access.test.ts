import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { testApplication } from '../../../tests/installation.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('initializes workspace access once without changing existing settings or restoring revoked access', async () => {
  const clef = await testApplication();
  cleanups.push(clef.dispose);
  const get = async () =>
    (
      await clef.server.inject({
        url: '/api/settings',
        headers: clef.headers,
      })
    ).json();
  const original = await get();
  expect(original.active.files).toEqual({
    global: false,
    directories: [
      {
        path: await realpath(join(clef.home, 'workspace')),
        access: 'read-write',
      },
    ],
  });

  const previous = structuredClone(original.active);
  delete previous.files;
  await writeFile(join(clef.home, 'settings.yaml'), JSON.stringify(previous));
  await clef.restart();
  const initialized = await get();
  expect(initialized.active).toEqual(original.active);
  expect(await readFile(join(clef.home, 'settings.yaml'), 'utf8')).toContain('files:');

  initialized.active.files.directories = [];
  const saved = await clef.server.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: clef.headers,
    payload: {
      revision: initialized.revision,
      source: JSON.stringify(initialized.active),
    },
  });
  expect(saved.statusCode).toBe(200);
  await clef.restart();
  expect((await get()).active.files.directories).toEqual([]);
});

it('requires explicit global confirmation through the full settings API too', async () => {
  const clef = await testApplication();
  cleanups.push(clef.dispose);
  const original = (
    await clef.server.inject({
      url: '/api/settings',
      headers: clef.headers,
    })
  ).json();
  const next = structuredClone(original.active);
  next.files.global = true;
  const payload = {
    revision: original.revision,
    source: JSON.stringify(next),
  };
  const rejected = await clef.server.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: clef.headers,
    payload,
  });
  expect(rejected.statusCode).toBe(400);
  expect(
    (
      await clef.server.inject({
        url: '/api/settings',
        headers: clef.headers,
      })
    ).json(),
  ).toEqual(original);
  const approved = await clef.server.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: clef.headers,
    payload: {
      ...payload,
      confirmGlobal: true,
    },
  });
  expect(approved.statusCode).toBe(200);
  expect(approved.json().active.files.global).toBe(true);
});
