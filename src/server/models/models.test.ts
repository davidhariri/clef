import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { testApplication } from '../../../tests/installation.js';
import { catalogSchema } from './contract.js';

let clef: Awaited<ReturnType<typeof testApplication>>;

beforeEach(async () => {
  clef = await testApplication();
});

afterEach(async () => {
  await clef.dispose();
});

it('persists defaults in YAML and retains a reloaded selection across restart', async () => {
  const path = join(clef.home, 'settings.yaml');
  const source = await readFile(path, 'utf8');
  expect(source).toContain('modelId: test-model');
  expect(source).not.toContain('test-api-key');
  await writeFile(path, source.replace('modelId: test-model', 'modelId: second-model'));
  const catalog = catalogSchema.parse(
    (
      await clef.server.inject({
        url: '/api/models',
        headers: clef.headers,
      })
    ).json(),
  );
  expect(catalog.defaults?.modelId).toBe('second-model');

  await clef.restart();
  const restored = catalogSchema.parse(
    (
      await clef.server.inject({
        url: '/api/models',
        headers: clef.headers,
      })
    ).json(),
  );
  expect(restored.defaults).toEqual({
    provider: 'openai',
    modelId: 'second-model',
    thinkingLevel: 'off',
  });
  expect(restored.providers).toContainEqual(
    expect.objectContaining({
      id: 'openai',
      connected: true,
    }),
  );
});

it('rejects overlapping revisions and unavailable selections without overwriting defaults', async () => {
  const catalog = catalogSchema.parse(
    (
      await clef.server.inject({
        url: '/api/models',
        headers: clef.headers,
      })
    ).json(),
  );
  const responses = await Promise.all(
    Array.from(
      {
        length: 2,
      },
      () =>
        clef.server.inject({
          method: 'PUT',
          url: '/api/models/default',
          headers: clef.headers,
          payload: {
            ...catalog.defaults,
            modelId: 'second-model',
            revision: catalog.revision,
          },
        }),
    ),
  );
  expect(responses.map((response) => response.statusCode).sort()).toEqual([
    200,
    409,
  ]);
  const saved = catalogSchema.parse(
    (
      await clef.server.inject({
        url: '/api/models',
        headers: clef.headers,
      })
    ).json(),
  );
  expect(saved.defaults?.modelId).toBe('second-model');
  const unavailable = await clef.server.inject({
    method: 'PUT',
    url: '/api/models/default',
    headers: clef.headers,
    payload: {
      ...saved.defaults,
      provider: 'other',
      revision: saved.revision,
    },
  });
  expect(unavailable.statusCode).toBe(400);
  expect(
    (
      await clef.server.inject({
        url: '/api/models',
        headers: clef.headers,
      })
    ).json(),
  ).toEqual(saved);
});
