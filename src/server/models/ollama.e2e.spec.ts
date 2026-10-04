import Fastify from 'fastify';
import { z } from 'zod';
import { test as base, expect } from '../../../tests/browser.js';
import { snapshotSchema } from '../messages/contract.js';
import { catalogSchema } from './contract.js';

const test = base.extend<{
  ollama: Awaited<ReturnType<typeof startOllama>>;
}>({
  ollama: async ({ page: _page }, use) => {
    const ollama = await startOllama();
    try {
      await use(ollama);
    } finally {
      await ollama.close();
    }
  },
});

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
  server.addHook('onRequest', async (request) => {
    requests.push({
      path: request.url,
      body: undefined,
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
        default: 'medium',
      },
    },
    {
      name: 'plain-test:small',
      capabilities: [
        'completion',
      ],
      thinking: {
        values: [
          false,
        ],
        default: false,
      },
    },
    {
      name: 'embed-test:small',
      capabilities: [
        'embedding',
      ],
      thinking: {
        values: [
          false,
        ],
        default: false,
      },
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
        remote_host: 'https://ollama.com',
        capabilities: [
          'completion',
          'thinking',
        ],
      };
    const found = models.find(({ name }) => name === model);
    return {
      ...found,
      model_info: {
        'general.architecture': 'test',
        'test.context_length': 8192,
      },
    };
  });
  server.post('/v1/chat/completions', async (request, reply) => {
    const body = z
      .object({
        model: z.string(),
      })
      .passthrough()
      .parse(request.body);
    const last = requests.at(-1);
    if (last) last.body = body;
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
          model: body.model,
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
    .getByText('Use local Ollama', {
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
  const catalog = catalogSchema.parse(
    await (await page.request.get(`${clef.url}/api/models`)).json(),
  );
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
  await page.getByPlaceholder('Message Clef…').fill('Say hello.');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  await expect(
    page
      .getByRole('article', {
        name: 'Clef reply',
      })
      .getByRole('paragraph'),
  ).toHaveText('Hello');
  await expect(
    page.getByRole('button', {
      name: 'Stop reply',
    }),
  ).toBeVisible();
  ollama.responseControl.release();
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText('Hello from local Ollama.');
  await expect(
    page.getByRole('button', {
      name: 'Stop reply',
    }),
  ).toHaveCount(0);
  expect(ollama.requests.find(({ path }) => path === '/v1/chat/completions')?.authorization).toBe(
    'Bearer ollama',
  );
  expect(ollama.requests.find(({ path }) => path === '/v1/chat/completions')?.body).toMatchObject({
    model: 'qwen-test:small',
    stream: true,
    reasoning_effort: 'medium',
  });
  expect(
    ollama.requests
      .filter(({ path }) => path !== '/v1/chat/completions')
      .every(({ authorization }) => authorization === undefined),
  ).toBe(true);
});

test('persists the Ollama endpoint and chosen defaults without changing existing conversations or cloud connections', async ({
  page,
  clef,
  ollama,
}) => {
  await clef.setup();
  const connection = await page.request.post(`${clef.url}/api/models/ollama`, {
    data: {
      url: ollama.url,
    },
  });
  expect(connection.ok()).toBe(true);
  const catalog = catalogSchema.parse(
    await (await page.request.get(`${clef.url}/api/models`)).json(),
  );
  expect(catalog.defaults?.provider).toBe('openai');
  await page.goto(clef.url);
  await page
    .getByRole('button', {
      name: 'Settings',
    })
    .click();
  await page
    .getByRole('combobox', {
      name: 'Provider',
      exact: true,
    })
    .click();
  await page
    .getByRole('option', {
      name: 'Ollama',
      exact: true,
    })
    .click();
  await page
    .getByRole('combobox', {
      name: 'Thinking',
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
  await expect(
    page.getByText('test-model', {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'New conversation',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('qwen-test:small', {
      exact: true,
    }),
  ).toBeVisible();
  const conversations = await (await page.request.get(`${clef.url}/api/conversations`)).json();
  const originalId = conversations[0].id;
  await page
    .getByRole('button', {
      name: 'Settings',
    })
    .click();
  await page
    .getByRole('combobox', {
      name: 'Model',
      exact: true,
    })
    .click();
  await page
    .getByRole('option', {
      name: 'plain-test:small',
      exact: true,
    })
    .click();
  await page
    .getByRole('combobox', {
      name: 'Thinking',
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
  await clef.restart();
  await page.reload();
  const restored = catalogSchema.parse(
    await (await page.request.get(`${clef.url}/api/models`)).json(),
  );
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
    await (await page.request.get(`${clef.url}/api/conversations/${originalId}`)).json(),
  );
  expect(original.conversation.model).toEqual({
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'xhigh',
  });
  await page.getByPlaceholder('Message Clef…').fill('Say hello after restart.');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText('Hello from local Ollama.');
  expect(
    ollama.requests.filter(({ path }) => path === '/v1/chat/completions').at(-1)?.body,
  ).toMatchObject({
    model: 'qwen-test:small',
    reasoning_effort: 'xhigh',
  });
  await page
    .getByRole('button', {
      name: 'New conversation',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('plain-test:small', {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Settings',
    })
    .click();
  await page
    .getByText('Manage connections', {
      exact: true,
    })
    .click();
  await page
    .getByText('Use local Ollama', {
      exact: true,
    })
    .click();
  await expect(page.getByLabel('Ollama server URL')).toHaveValue(ollama.url);
});

test('keeps the selected provider and explains an Ollama outage across restart', async ({
  page,
  clef,
  ollama,
}) => {
  await clef.setup();
  expect(
    (
      await page.request.post(`${clef.url}/api/models/ollama`, {
        data: {
          url: ollama.url,
        },
      })
    ).ok(),
  ).toBe(true);
  const selection = {
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'off',
  };
  expect(
    (
      await page.request.put(`${clef.url}/api/models/default`, {
        data: selection,
      })
    ).ok(),
  ).toBe(true);
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
  const catalog = catalogSchema.parse(
    await (await page.request.get(`${clef.url}/api/models`)).json(),
  );
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
    .getByText('Use local Ollama', {
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
}) => {
  await clef.setup();
  expect(
    (
      await page.request.post(`${clef.url}/api/models/ollama`, {
        data: {
          url: ollama.url,
        },
      })
    ).ok(),
  ).toBe(true);
  const before = catalogSchema.parse(
    await (await page.request.get(`${clef.url}/api/models`)).json(),
  );
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
    `http://name:secret@127.0.0.1:11434`,
    `${ollama.url}?secret=value`,
    `${ollama.url}#fragment`,
  ]) {
    const response = await page.request.post(`${clef.url}/api/models/ollama`, {
      data: {
        url,
      },
    });
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
  ]) {
    const response = await page.request.put(`${clef.url}/api/models/default`, {
      data: selection,
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Choose an available model and thinking level.',
    });
  }
  expect(
    catalogSchema.parse(await (await page.request.get(`${clef.url}/api/models`)).json()),
  ).toEqual(before);
  await clef.restart();
  expect(
    catalogSchema.parse(await (await page.request.get(`${clef.url}/api/models`)).json()),
  ).toEqual(before);
});

test('discovers only installed local chat models, not cloud aliases', async ({
  page,
  clef,
  ollama,
}) => {
  await clef.setup();
  ollama.remoteModels.push('cloud-alias');
  const response = await page.request.post(`${clef.url}/api/models/ollama`, {
    data: {
      url: ollama.url,
    },
  });
  expect(response.ok()).toBe(true);
  const catalog = catalogSchema.parse(
    await (await page.request.get(`${clef.url}/api/models`)).json(),
  );
  expect(
    catalog.models.filter(({ provider }) => provider === 'ollama').map(({ id }) => id),
  ).toEqual([
    'qwen-test:small',
    'plain-test:small',
  ]);
});

test('explains empty and invalid discovery without saving a failed connection', async ({
  page,
  clef,
  ollama,
}) => {
  await clef.setup();
  ollama.models.splice(0);
  for (const status of [
    200,
    503,
  ]) {
    ollama.responseControl.discoveryStatus = status;
    const response = await page.request.post(`${clef.url}/api/models/ollama`, {
      data: {
        url: ollama.url,
      },
    });
    expect(response.status()).toBe(status === 200 ? 400 : 502);
    expect(await response.json()).toEqual({
      error:
        status === 200
          ? 'Ollama has no installed local chat models. Install a chat model on that server, then connect again.'
          : 'Ollama model discovery failed (HTTP 503). Check the server and installed models.',
    });
  }
  ollama.responseControl.invalidDiscovery = true;
  const invalid = await page.request.post(`${clef.url}/api/models/ollama`, {
    data: {
      url: ollama.url,
    },
  });
  expect(invalid.status()).toBe(502);
  expect(await invalid.json()).toEqual({
    error: 'Ollama returned an invalid model list.',
  });
  await clef.restart();
  const catalog = catalogSchema.parse(
    await (await page.request.get(`${clef.url}/api/models`)).json(),
  );
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
}) => {
  await clef.setup();
  expect(
    (
      await page.request.post(`${clef.url}/api/models/ollama`, {
        data: {
          url: ollama.url,
        },
      })
    ).ok(),
  ).toBe(true);
  const selection = {
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'off',
  };
  expect(
    (
      await page.request.put(`${clef.url}/api/models/default`, {
        data: selection,
      })
    ).ok(),
  ).toBe(true);
  ollama.responseControl.inferenceError = true;
  await page.goto(clef.url);
  await page.getByPlaceholder('Message Clef…').fill('Say hello.');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText(
    'The model request failed. Check your connection, model access, and provider settings.',
  );
  await expect(
    page.getByRole('button', {
      name: 'Stop reply',
    }),
  ).toHaveCount(0);
  expect(
    ollama.requests.filter(({ path }) => path === '/v1/chat/completions').at(-1)?.body,
  ).toMatchObject({
    model: 'qwen-test:small',
    reasoning_effort: 'none',
  });
  const catalog = catalogSchema.parse(
    await (await page.request.get(`${clef.url}/api/models`)).json(),
  );
  expect(catalog.defaults).toEqual(selection);
  const id = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('chat');
  const snapshot = snapshotSchema.parse(
    await (await page.request.get(`${clef.url}/api/conversations/${id}`)).json(),
  );
  expect(snapshot.conversation.model).toEqual(selection);
  expect(snapshot.messages.filter(({ role }) => role === 'assistant')).toHaveLength(1);
  expect(snapshot.messages.at(-1)?.error).toBe(true);
});

test('keeps missing model defaults explicit after refreshing the installed model list', async ({
  page,
  clef,
  ollama,
}) => {
  await clef.setup();
  expect(
    (
      await page.request.post(`${clef.url}/api/models/ollama`, {
        data: {
          url: ollama.url,
        },
      })
    ).ok(),
  ).toBe(true);
  const selection = {
    provider: 'ollama',
    modelId: 'qwen-test:small',
    thinkingLevel: 'medium',
  };
  expect(
    (
      await page.request.put(`${clef.url}/api/models/default`, {
        data: selection,
      })
    ).ok(),
  ).toBe(true);
  await page.goto(clef.url);
  await expect(
    page.getByText('qwen-test:small', {
      exact: true,
    }),
  ).toBeVisible();
  ollama.models.splice(0, 1);
  expect(
    (
      await page.request.post(`${clef.url}/api/models/ollama`, {
        data: {
          url: ollama.url,
        },
      })
    ).ok(),
  ).toBe(true);
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
  const catalog = catalogSchema.parse(
    await (await page.request.get(`${clef.url}/api/models`)).json(),
  );
  expect(catalog.defaults).toEqual(selection);
});

test('offers off and medium for boolean thinking and sends the enabled setting', async ({
  page,
  clef,
  ollama,
}) => {
  await clef.setup();
  const model = ollama.models[0];
  if (!model) throw new Error('Missing synthetic model.');
  model.thinking.values = [
    false,
    true,
  ];
  expect(
    (
      await page.request.post(`${clef.url}/api/models/ollama`, {
        data: {
          url: ollama.url,
        },
      })
    ).ok(),
  ).toBe(true);
  const catalog = catalogSchema.parse(
    await (await page.request.get(`${clef.url}/api/models`)).json(),
  );
  expect(
    catalog.models.find(({ provider, id }) => provider === 'ollama' && id === 'qwen-test:small')
      ?.thinkingLevels,
  ).toEqual([
    'off',
    'medium',
  ]);
  expect(
    (
      await page.request.put(`${clef.url}/api/models/default`, {
        data: {
          provider: 'ollama',
          modelId: 'qwen-test:small',
          thinkingLevel: 'medium',
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(clef.url);
  await page.getByPlaceholder('Message Clef…').fill('Say hello with thinking enabled.');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText('Hello from local Ollama.');
  expect(ollama.requests.find(({ path }) => path === '/v1/chat/completions')?.body).toMatchObject({
    reasoning_effort: 'medium',
  });
});
