import type { APIRequestContext } from '@playwright/test';
import Fastify from 'fastify';
import { z } from 'zod';
import { test as base, expect } from '../../../tests/api.js';
import { catalogSchema, type ModelSettings } from './contract.js';

const test = base.extend<{
  ollama: Awaited<ReturnType<typeof startOllama>>;
  models: ReturnType<typeof modelApi>;
}>({
  ollama: async ({ clef: _clef }, use) => {
    const ollama = await startOllama();
    try {
      await use(ollama);
    } finally {
      await ollama.close();
    }
  },
  models: async ({ clef }, use) => {
    await use(modelApi(clef.request));
  },
});

function modelApi(request: APIRequestContext) {
  return {
    catalog: async () => catalogSchema.parse(await (await request.get('/api/models')).json()),
    connect: (url: string) =>
      request.post('/api/models/ollama', {
        data: {
          url,
        },
      }),
    defaults: async (selection: ModelSettings) => {
      const catalog = catalogSchema.parse(await (await request.get('/api/models')).json());
      return request.put('/api/models/default', {
        data: {
          ...selection,
          revision: catalog.revision,
        },
      });
    },
  };
}

async function startOllama() {
  const server = Fastify();
  const responseControl = {
    pause: false,
    release: () => {},
    invalidDiscovery: false,
    discoveryStatus: 200,
    inferenceError: false,
  };
  const remoteModels: string[] = [];
  const requests: {
    path: string;
    body: unknown;
    authorization: string | undefined;
  }[] = [];
  server.addHook('preHandler', async (request) => {
    requests.push({
      path: request.url,
      body: request.body,
      authorization: request.headers.authorization,
    });
  });
  const models = [
    {
      name: 'qwen-test:small',
      capabilities: [
        'completion',
        'thinking',
        'vision',
      ],
      thinking: {
        values: [
          false,
          'low',
          'medium',
          'xhigh',
        ],
      },
    },
    {
      name: 'plain-test:small',
      capabilities: [
        'completion',
      ],
    },
    {
      name: 'embed-test:small',
      capabilities: [
        'embedding',
      ],
    },
  ];
  server.get('/api/tags', async (_request, reply) => {
    if (responseControl.invalidDiscovery)
      return {
        unexpected: true,
      };
    if (responseControl.discoveryStatus !== 200)
      return reply.code(responseControl.discoveryStatus).send({
        error: 'synthetic discovery failure',
      });
    return {
      models: [
        ...models.map(({ name }) => ({
          name,
        })),
        ...remoteModels.map((name) => ({
          name,
        })),
      ],
    };
  });
  server.post('/api/show', async (request) => {
    const { model } = z
      .object({
        model: z.string(),
      })
      .parse(request.body);
    if (remoteModels.includes(model))
      return {
        remote_model: 'remote-model',
        capabilities: [
          'completion',
          'thinking',
        ],
      };
    return {
      ...models.find(({ name }) => name === model),
      model_info: {
        'general.architecture': 'test',
        'test.context_length': 8192,
      },
    };
  });
  server.post('/v1/chat/completions', async (request, reply) => {
    const { model } = z
      .object({
        model: z.string(),
      })
      .parse(request.body);
    if (responseControl.inferenceError)
      return reply.code(404).send({
        error: {
          message: 'The selected model is not installed.',
          type: 'not_found',
        },
      });
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
    });
    const chunk = (content: string, finish: string | null = null) => {
      reply.raw.write(
        `data: ${JSON.stringify({
          id: 'synthetic-chat',
          object: 'chat.completion.chunk',
          created: 1,
          model,
          choices: [
            {
              index: 0,
              delta: {
                content,
              },
              finish_reason: finish,
            },
          ],
        })}\n\n`,
      );
    };
    chunk('Hello');
    if (responseControl.pause)
      await new Promise<void>((resolve) => {
        responseControl.release = resolve;
      });
    chunk(' from local Ollama.', 'stop');
    reply.raw.end('data: [DONE]\n\n');
  });
  const url = await server.listen({
    port: 0,
    host: '127.0.0.1',
  });
  return {
    url,
    requests,
    models,
    responseControl,
    remoteModels,
    close: () => {
      responseControl.release();
      return server.close();
    },
  };
}

test('connects Ollama without a key and streams through the selected local model', async ({
  clef,
  ollama,
  models,
}) => {
  expect((await models.connect(`${ollama.url}/`)).ok()).toBe(true);
  const catalog = await models.catalog();
  expect(catalog.defaults).toEqual({
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'medium',
  });
  expect(catalog.models).toEqual([
    {
      provider: 'ollama',
      id: 'qwen-test:small',
      name: 'qwen-test:small',
      thinkingLevels: [
        'off',
        'low',
        'medium',
        'xhigh',
      ],
    },
    {
      provider: 'ollama',
      id: 'plain-test:small',
      name: 'plain-test:small',
      thinkingLevels: [
        'off',
      ],
    },
  ]);
  ollama.responseControl.pause = true;
  await clef.send('Say hello.');
  await expect.poll(async () => (await clef.snapshot()).messages.at(-1)?.text).toBe('Hello');
  expect((await clef.snapshot()).busy).toBe(true);
  ollama.responseControl.release();
  await expect
    .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
    .toBe('Hello from local Ollama.');
  await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
  expect(ollama.requests.find(({ path }) => path === '/v1/chat/completions')).toMatchObject({
    authorization: 'Bearer ollama',
    body: {
      model: 'qwen-test:small',
      stream: true,
      reasoning_effort: 'medium',
    },
  });
  expect(
    ollama.requests
      .filter(({ path }) => path !== '/v1/chat/completions')
      .every(({ authorization }) => authorization === undefined),
  ).toBe(true);
});

test('persists the endpoint and applies defaults to the next message without changing cloud connections', async ({
  clef,
  ollama,
  models,
}) => {
  await clef.connect();
  expect((await models.connect(ollama.url)).ok()).toBe(true);
  expect((await models.catalog()).defaults?.provider).toBe('openai');
  expect((await clef.settings()).active.models.connections).toContainEqual({
    provider: 'ollama',
    url: ollama.url,
  });
  await clef.snapshot();
  expect(
    (
      await models.defaults({
        provider: 'ollama',
        modelId: 'qwen-test:small',
        thinkingLevel: 'xhigh',
      })
    ).ok(),
  ).toBe(true);
  expect((await clef.snapshot()).conversation.model.modelId).toBe('test-model');
  await clef.send('Use local model');
  await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
  expect(
    ollama.requests.filter(({ path }) => path === '/v1/chat/completions').at(-1)?.body,
  ).toMatchObject({
    model: 'qwen-test:small',
    reasoning_effort: 'xhigh',
  });
  expect(
    (
      await models.defaults({
        provider: 'ollama',
        modelId: 'plain-test:small',
        thinkingLevel: 'off',
      })
    ).ok(),
  ).toBe(true);
  await clef.restart();
  const restored = await models.catalog();
  expect(restored.providers.find(({ id }) => id === 'ollama')).toMatchObject({
    connected: true,
    url: ollama.url,
  });
  expect(restored.providers.find(({ id }) => id === 'openai')?.connected).toBe(true);
  expect(restored.defaults).toEqual({
    provider: 'ollama',
    modelId: 'plain-test:small',
    thinkingLevel: 'off',
  });
  expect((await clef.snapshot()).conversation.model.modelId).toBe('qwen-test:small');
  await clef.send('After restart');
  await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
  const next = ollama.requests.filter(({ path }) => path === '/v1/chat/completions').at(-1)?.body;
  expect(next).toMatchObject({
    model: 'plain-test:small',
  });
  expect(next).not.toHaveProperty('reasoning_effort');
});

test('keeps the selected provider and explains an Ollama outage across restart', async ({
  clef,
  ollama,
  models,
}) => {
  await clef.connect();
  await models.connect(ollama.url);
  const selection: ModelSettings = {
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'off',
  };
  await models.defaults(selection);
  await ollama.close();
  await clef.restart();
  const catalog = await models.catalog();
  expect(catalog.defaults).toEqual(selection);
  expect(catalog.providers.find(({ id }) => id === 'ollama')).toMatchObject({
    connected: true,
    url: ollama.url,
    error: expect.stringContaining('Cannot reach Ollama'),
  });
  expect(catalog.models.filter(({ provider }) => provider === 'ollama')).toEqual([]);
  expect((await models.connect(ollama.url)).ok()).toBe(false);
  const stop = new AbortController();
  let streamedError = false;
  const watching = clef.client.watch(
    stop.signal,
    (snapshot) => {
      streamedError = snapshot.messages.at(-1)?.error === true;
    },
    () => undefined,
  );
  try {
    await clef.send('Are you available?');
    await expect.poll(() => streamedError).toBe(true);
    expect((await clef.snapshot()).messages.at(-1)).toMatchObject({
      role: 'assistant',
      error: true,
      pending: false,
      text: expect.stringContaining('selected model is unavailable'),
    });
  } finally {
    stop.abort();
    await watching;
  }
  const failed = (await clef.snapshot()).messages.at(-1);
  await clef.restart();
  expect((await clef.snapshot()).messages.at(-1)).toEqual(failed);
});

test('recovers failed startup discovery on the next message without reconnecting or changing defaults', async ({
  clef,
  ollama,
  models,
}) => {
  await clef.connect();
  await models.connect(ollama.url);
  const selection: ModelSettings = {
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'off',
  };
  await models.defaults(selection);
  ollama.responseControl.discoveryStatus = 503;
  await clef.restart();
  expect((await models.catalog()).models.filter((model) => model.provider === 'ollama')).toEqual(
    [],
  );
  await clef.send('Are you unavailable?');
  await expect.poll(async () => (await clef.snapshot()).messages.at(-1)?.error).toBe(true);
  ollama.responseControl.discoveryStatus = 200;
  await clef.send('Are you back?');
  await expect
    .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
    .toBe('Hello from local Ollama.');
  const catalog = await models.catalog();
  expect(catalog.defaults).toEqual(selection);
  expect(catalog.providers.find((provider) => provider.id === 'ollama')?.error).toBeUndefined();
  const snapshot = await clef.snapshot();
  expect(snapshot.conversation.model).toEqual(selection);
  expect(snapshot.messages).toHaveLength(4);
  expect(snapshot.messages[1]?.error).toBe(true);
  expect(snapshot.messages.filter((message) => message.error)).toHaveLength(1);
});

test('rejects invalid settings and key entry without changing a working connection', async ({
  clef,
  ollama,
  models,
}) => {
  await clef.connect();
  await models.connect(ollama.url);
  const before = await models.catalog();
  const key = await clef.request.post('/api/models/key', {
    data: {
      provider: 'ollama',
      key: 'not-a-real-key',
    },
  });
  expect(key.status()).toBe(400);
  expect(await key.json()).toEqual({
    error: 'Ollama uses a server URL, not an API key.',
  });
  for (const url of [
    'file:///tmp/ollama',
    `${ollama.url}/v1`,
    'http://name:secret@127.0.0.1:11434',
    `${ollama.url}?secret=value`,
    `${ollama.url}#fragment`,
  ]) {
    const response = await models.connect(url);
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Use the Ollama server URL without credentials, a path, a query, or a fragment.',
    });
  }
  for (const selection of [
    {
      provider: 'ollama',
      modelId: 'missing',
      thinkingLevel: 'off',
    },
    {
      provider: 'ollama',
      modelId: 'plain-test:small',
      thinkingLevel: 'high',
    },
    {
      provider: 'ollama',
      modelId: 'qwen-test:small',
      thinkingLevel: 'high',
    },
  ] satisfies ModelSettings[]) {
    const response = await models.defaults(selection);
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Choose an available model and thinking level.',
    });
  }
  expect(await models.catalog()).toEqual(before);
  await clef.restart();
  expect(await models.catalog()).toEqual(before);
});

test('discovers only installed local chat models, not cloud aliases', async ({
  clef,
  ollama,
  models,
}) => {
  await clef.connect();
  ollama.remoteModels.push('cloud-alias');
  await models.connect(ollama.url);
  expect(
    (await models.catalog()).models
      .filter(({ provider }) => provider === 'ollama')
      .map(({ id }) => id),
  ).toEqual([
    'qwen-test:small',
    'plain-test:small',
  ]);
});

test('explains empty and invalid discovery without saving a failed connection', async ({
  clef,
  ollama,
  models,
}) => {
  await clef.connect();
  ollama.models.splice(0);
  for (const status of [
    200,
    503,
  ]) {
    ollama.responseControl.discoveryStatus = status;
    const response = await models.connect(ollama.url);
    expect(response.status()).toBe(status === 200 ? 400 : 502);
    expect(await response.json()).toEqual({
      error:
        status === 200
          ? 'Ollama has no installed local chat models. Install a chat model on that server, then connect again.'
          : 'Ollama model discovery failed (HTTP 503). Check the server and installed models.',
    });
  }
  ollama.responseControl.invalidDiscovery = true;
  expect(await (await models.connect(ollama.url)).json()).toEqual({
    error: 'Ollama returned an invalid model list.',
  });
  await clef.restart();
  const catalog = await models.catalog();
  expect(catalog.defaults?.provider).toBe('openai');
  expect(catalog.providers.find(({ id }) => id === 'ollama')).toEqual({
    id: 'ollama',
    name: 'Ollama',
    oauth: false,
    connected: false,
  });
});

test('reports inference failure without switching to a connected cloud provider', async ({
  clef,
  ollama,
  models,
}) => {
  await clef.connect();
  await models.connect(ollama.url);
  const selection: ModelSettings = {
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'off',
  };
  await models.defaults(selection);
  ollama.responseControl.inferenceError = true;
  await clef.send('Say hello');
  await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
  expect((await clef.snapshot()).messages.at(-1)?.text).toContain(
    'The model request failed. Check your connection, model access, and provider settings.',
  );
  expect(
    ollama.requests.filter(({ path }) => path === '/v1/chat/completions').at(-1)?.body,
  ).toMatchObject({
    model: 'qwen-test:small',
    reasoning_effort: 'none',
  });
  expect((await models.catalog()).defaults).toEqual(selection);
  const snapshot = await clef.snapshot();
  expect(snapshot.conversation.model).toEqual(selection);
  expect(snapshot.messages.filter(({ role }) => role === 'assistant')).toHaveLength(1);
  expect(snapshot.messages.at(-1)?.error).toBe(true);
});

test('keeps missing model defaults explicit after refreshing the installed model list', async ({
  clef,
  ollama,
  models,
}) => {
  await clef.connect();
  await models.connect(ollama.url);
  const selection: ModelSettings = {
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'medium',
  };
  await models.defaults(selection);
  ollama.models.splice(0, 1);
  await models.connect(ollama.url);
  const catalog = await models.catalog();
  expect(catalog.defaults).toEqual(selection);
  expect(
    catalog.models.some((model) => model.provider === 'ollama' && model.id === selection.modelId),
  ).toBe(false);
});

test('offers off and medium for boolean thinking and sends the enabled setting', async ({
  clef,
  ollama,
  models,
}) => {
  await clef.connect();
  const model = ollama.models[0];
  if (!model?.thinking) throw new Error('Missing synthetic thinking model.');
  model.thinking.values = [
    false,
    true,
  ];
  await models.connect(ollama.url);
  expect(
    (await models.catalog()).models.find(
      ({ provider, id }) => provider === 'ollama' && id === 'qwen-test:small',
    )?.thinkingLevels,
  ).toEqual([
    'off',
    'medium',
  ]);
  await models.defaults({
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'medium',
  });
  await clef.send('Say hello');
  await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
  expect(ollama.requests.find(({ path }) => path === '/v1/chat/completions')?.body).toMatchObject({
    reasoning_effort: 'medium',
  });
});
