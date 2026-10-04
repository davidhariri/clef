import type { APIRequestContext, Page } from '@playwright/test';
import Fastify from 'fastify';
import { z } from 'zod';
import { test as base, expect } from '../../../tests/browser.js';
import { snapshotSchema } from '../messages/contract.js';
import { catalogSchema, type ModelSettings } from './contract.js';

const test = base.extend<{
  ollama: Awaited<ReturnType<typeof startOllama>>;
  models: ReturnType<typeof modelApi>;
}>({
  ollama: async ({ page: _page }, use) => {
    const ollama = await startOllama();
    try {
      await use(ollama);
    } finally {
      await ollama.close();
    }
  },
  models: async ({ page, clef }, use) => {
    await use(modelApi(page.request, clef.url));
  },
});

function modelApi(request: APIRequestContext, url: string) {
  return {
    catalog: async () => catalogSchema.parse(await (await request.get(`${url}/api/models`)).json()),
    connect: (serverUrl: string) =>
      request.post(`${url}/api/models/ollama`, {
        data: {
          url: serverUrl,
        },
      }),
    defaults: (selection: ModelSettings) =>
      request.put(`${url}/api/models/default`, {
        data: selection,
      }),
  };
}

async function choose(page: Page, field: string, option: string) {
  await page
    .getByRole('combobox', {
      name: field,
      exact: true,
    })
    .click();
  await page
    .getByRole('option', {
      name: option,
      exact: true,
    })
    .click();
}

async function openConnections(page: Page) {
  await page
    .getByRole('button', {
      name: 'Settings',
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Manage connections',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Ollama',
      exact: true,
    })
    .click();
}

async function send(page: Page, text: string) {
  await page.getByPlaceholder('Message Clef…').fill(text);
  await page.getByLabel('Send message').click();
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

test('connects Ollama in web setup without a key and streams through the selected local model', async ({
  page,
  clef,
  ollama,
  models,
}) => {
  await page.goto(clef.setupUrl);
  await page.getByLabel('Username').fill('synthetic-user');
  await page
    .getByLabel('Password', {
      exact: true,
    })
    .fill('a synthetic test password');
  await page
    .getByRole('button', {
      name: 'Generate key',
    })
    .click();
  await page.getByLabel('I saved my recovery key').check();
  await page
    .getByRole('button', {
      name: 'Create account',
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Ollama',
      exact: true,
    })
    .click();
  await page.getByLabel('Ollama server URL').fill(`${ollama.url}/`);
  await page
    .getByRole('button', {
      name: 'Connect Ollama',
    })
    .click();
  await expect(page.getByPlaceholder('Message Clef…')).toBeVisible();

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
  await send(page, 'Say hello.');
  const reply = page.getByLabel('Clef reply');
  await expect(reply.getByRole('paragraph')).toHaveText('Hello');
  await expect(page.getByLabel('Stop reply')).toBeVisible();
  ollama.responseControl.release();
  await expect(reply).toContainText('Hello from local Ollama.');
  await expect(page.getByLabel('Stop reply')).toHaveCount(0);
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

test('persists the Ollama endpoint and applies saved defaults to the next message without changing cloud connections', async ({
  page,
  clef,
  ollama,
  models,
}) => {
  await clef.setup();
  expect((await models.connect(ollama.url)).ok()).toBe(true);
  expect((await models.catalog()).defaults?.provider).toBe('openai');
  await page.goto(clef.url);
  await page
    .getByRole('button', {
      name: 'Settings',
    })
    .click();
  await choose(page, 'Provider', 'Ollama');
  await page
    .getByLabel('Thinking', {
      exact: true,
    })
    .click();
  await expect(page.getByRole('option')).toHaveText([
    'off',
    'low',
    'medium',
    'xhigh',
  ]);
  await page
    .getByRole('option', {
      name: 'xhigh',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Save defaults',
    })
    .click();
  await expect(page.getByRole('status')).toHaveText(
    'Defaults saved. Applies to your next message.',
  );
  await page
    .getByRole('button', {
      name: 'Close',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('test-model', {
      exact: true,
    }),
  ).toBeVisible();
  await send(page, 'Use the local model.');
  await expect(page.getByLabel('Clef reply')).toContainText('Hello from local Ollama.');
  await expect(page.getByLabel('Stop reply')).toHaveCount(0);
  await expect(
    page.getByText('qwen-test:small', {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    ollama.requests.filter(({ path }) => path === '/v1/chat/completions').at(-1)?.body,
  ).toMatchObject({
    model: 'qwen-test:small',
    reasoning_effort: 'xhigh',
  });

  await page
    .getByRole('button', {
      name: 'Settings',
    })
    .click();
  await choose(page, 'Model', 'plain-test:small');
  await page
    .getByLabel('Thinking', {
      exact: true,
    })
    .click();
  await expect(page.getByRole('option')).toHaveText([
    'off',
  ]);
  await page
    .getByRole('option', {
      name: 'off',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Save defaults',
    })
    .click();
  await expect(page.getByRole('status')).toHaveText(
    'Defaults saved. Applies to your next message.',
  );
  await clef.restart();
  await page.reload();

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
  const original = snapshotSchema.parse(
    await (await page.request.get(`${clef.url}/api/conversation`)).json(),
  );
  expect(original.conversation.model).toEqual({
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'xhigh',
  });
  await send(page, 'Say hello after restart.');
  await expect(page.getByLabel('Clef reply')).toHaveCount(2);
  await expect(page.getByLabel('Clef reply').last()).toContainText('Hello from local Ollama.');
  const nextRequest = ollama.requests
    .filter(({ path }) => path === '/v1/chat/completions')
    .at(-1)?.body;
  expect(nextRequest).toMatchObject({
    model: 'plain-test:small',
  });
  expect(nextRequest).not.toHaveProperty('reasoning_effort');
  await expect(
    page.getByText('plain-test:small', {
      exact: true,
    }),
  ).toBeVisible();
  await openConnections(page);
  await expect(page.getByLabel('Ollama server URL')).toHaveValue(ollama.url);
});

test('keeps the selected provider and explains an Ollama outage across restart', async ({
  page,
  clef,
  ollama,
  models,
}) => {
  await clef.setup();
  expect((await models.connect(ollama.url)).ok()).toBe(true);
  const selection: ModelSettings = {
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'off',
  };
  expect((await models.defaults(selection)).ok()).toBe(true);
  await page.goto(clef.url);
  await expect(page.getByPlaceholder('Message Clef…')).toBeVisible();
  await ollama.close();
  await clef.restart();
  await page.reload();
  await page
    .getByRole('button', {
      name: 'Settings',
    })
    .click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach Ollama');

  const catalog = await models.catalog();
  expect(catalog.defaults).toEqual(selection);
  expect(catalog.providers.find(({ id }) => id === 'ollama')).toMatchObject({
    connected: true,
    url: ollama.url,
  });
  expect(catalog.models.filter(({ provider }) => provider === 'ollama')).toEqual([]);
  await page
    .getByText('Manage connections', {
      exact: true,
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Ollama',
      exact: true,
    })
    .click();
  await expect(page.getByLabel('Ollama server URL')).toHaveValue(ollama.url);
  await page
    .getByRole('button', {
      name: 'Connect Ollama',
    })
    .click();
  await expect(page.getByRole('alert').last()).toContainText('Cannot reach Ollama');
});

test('rejects invalid settings and key entry without changing a working connection', async ({
  page,
  clef,
  ollama,
  models,
}) => {
  await clef.setup();
  expect((await models.connect(ollama.url)).ok()).toBe(true);
  const before = await models.catalog();
  const key = await page.request.post(`${clef.url}/api/models/key`, {
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
  const invalid: ModelSettings[] = [
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
  ];
  for (const selection of invalid) {
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
  await clef.setup();
  ollama.remoteModels.push('cloud-alias');
  expect((await models.connect(ollama.url)).ok()).toBe(true);
  const catalog = await models.catalog();
  expect(
    catalog.models.filter(({ provider }) => provider === 'ollama').map(({ id }) => id),
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
  await clef.setup();
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
  const invalid = await models.connect(ollama.url);
  expect(invalid.status()).toBe(502);
  expect(await invalid.json()).toEqual({
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

test('reports model inference failure without switching to a connected cloud provider', async ({
  page,
  clef,
  ollama,
  models,
}) => {
  await clef.setup();
  expect((await models.connect(ollama.url)).ok()).toBe(true);
  const selection: ModelSettings = {
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'off',
  };
  expect((await models.defaults(selection)).ok()).toBe(true);
  ollama.responseControl.inferenceError = true;
  await page.goto(clef.url);
  await send(page, 'Say hello.');
  await expect(page.getByLabel('Clef reply')).toContainText(
    'The model request failed. Check your connection, model access, and provider settings.',
  );
  await expect(page.getByLabel('Stop reply')).toHaveCount(0);
  expect(
    ollama.requests.filter(({ path }) => path === '/v1/chat/completions').at(-1)?.body,
  ).toMatchObject({
    model: 'qwen-test:small',
    reasoning_effort: 'none',
  });
  expect((await models.catalog()).defaults).toEqual(selection);
  const snapshot = snapshotSchema.parse(
    await (await page.request.get(`${clef.url}/api/conversation`)).json(),
  );
  expect(snapshot.conversation.model).toEqual(selection);
  expect(snapshot.messages.filter(({ role }) => role === 'assistant')).toHaveLength(1);
  expect(snapshot.messages.at(-1)?.error).toBe(true);
});

test('keeps missing model defaults explicit after refreshing the installed model list', async ({
  page,
  clef,
  ollama,
  models,
}) => {
  await clef.setup();
  expect((await models.connect(ollama.url)).ok()).toBe(true);
  const selection: ModelSettings = {
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'medium',
  };
  expect((await models.defaults(selection)).ok()).toBe(true);
  await page.goto(clef.url);
  await expect(
    page.getByText('qwen-test:small', {
      exact: true,
    }),
  ).toBeVisible();
  ollama.models.splice(0, 1);
  expect((await models.connect(ollama.url)).ok()).toBe(true);
  await page
    .getByRole('button', {
      name: 'Settings',
    })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'The selected model is unavailable. Connect its server or choose another model.',
  );
  await expect(
    page.getByRole('button', {
      name: 'Save defaults',
    }),
  ).toBeDisabled();
  expect((await models.catalog()).defaults).toEqual(selection);
});

test('offers off and medium for boolean thinking and sends the enabled setting', async ({
  page,
  clef,
  ollama,
  models,
}) => {
  await clef.setup();
  const model = ollama.models[0];
  if (!model?.thinking) throw new Error('Missing synthetic thinking model.');
  model.thinking.values = [
    false,
    true,
  ];
  expect((await models.connect(ollama.url)).ok()).toBe(true);
  const catalog = await models.catalog();
  expect(
    catalog.models.find(({ provider, id }) => provider === 'ollama' && id === 'qwen-test:small')
      ?.thinkingLevels,
  ).toEqual([
    'off',
    'medium',
  ]);
  const selection: ModelSettings = {
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'medium',
  };
  expect((await models.defaults(selection)).ok()).toBe(true);
  await page.goto(clef.url);
  await send(page, 'Say hello with thinking enabled.');
  await expect(page.getByLabel('Clef reply')).toContainText('Hello from local Ollama.');
  expect(ollama.requests.find(({ path }) => path === '/v1/chat/completions')?.body).toMatchObject({
    reasoning_effort: 'medium',
  });
});
