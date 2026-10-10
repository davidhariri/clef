import { expect, test } from '../../../tests/api.js';

for (const [name, overrides] of Object.entries({
  policy: {
    permissions: [
      {
        origin: 'https://untrusted.example',
        method: 'GET',
        decision: 'allow',
      },
    ],
  },
  oversized: {
    defaults: {
      provider: 'openai',
      modelId: 'x'.repeat(121),
      thinkingLevel: 'off',
    },
  },
  unknownModel: {
    defaults: {
      provider: 'openai',
      modelId: 'missing',
      thinkingLevel: 'off',
    },
  },
})) {
  test.describe(`untrusted ${name} input`, () => {
    test.use({
      configurationOverrides: overrides,
    });
    test('rejects the tool call without an approval or settings change', async ({ clef }) => {
      await clef.connect();
      const before = await clef.settings();
      await clef.send('configure switch');
      await expect
        .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
        .toContain('Rejected.');
      expect(await clef.settings()).toEqual(before);
      expect((await clef.snapshot()).permissions).toEqual([]);
    });
  });
}

test.describe('bounded inspection', () => {
  test.use({
    modelName: 'x'.repeat(16384),
  });
  test('rejects an oversized tool result before returning it to the model', async ({ clef }) => {
    await clef.connect();
    const before = await clef.settings();
    await clef.send('configure switch');
    await expect
      .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
      .toContain('Configuration inspection rejected.');
    const view = await clef.snapshot();
    expect(view.permissions).toEqual([]);
    expect(view.messages.filter((message) => message.role === 'tool')).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('exceeds 16 KiB'),
      }),
    ]);
    expect(JSON.stringify(view)).not.toContain('x'.repeat(16384));
    expect(await clef.settings()).toEqual(before);
  });
});

for (const choice of [
  'deny',
  'never',
]) {
  test(`${choice} blocks writes and switches without leaking secrets`, async ({ clef }) => {
    await clef.connect();
    const before = await clef.settings();
    await clef.send('configure switch');
    await expect.poll(async () => (await clef.snapshot()).permissions.length).toBe(1);
    const pending = await clef.snapshot();
    const request = pending.permissions[0];
    expect(request).toMatchObject({
      kind: 'configuration',
      conversationId: pending.conversation.id,
      revision: before.revision,
      defaults: {
        provider: 'openai',
        modelId: 'second-model',
        thinkingLevel: 'off',
      },
      switchConversation: true,
    });
    expect(JSON.stringify(pending)).not.toContain('test-api-key');
    expect(JSON.stringify(pending)).not.toContain(clef.token);
    expect(await clef.settings()).toEqual(before);
    expect(
      (
        await clef.request.post(`/api/conversation/permissions/${request?.id}`, {
          data: {
            choice,
          },
        })
      ).ok(),
    ).toBe(true);
    await expect
      .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
      .toContain('Configuration finished on test-model. Rejected.');
    const after = await clef.settings();
    expect(after.active.models).toEqual(before.active.models);
    expect(after.active.permissions).toHaveLength(choice === 'never' ? 1 : 0);
    await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
    await clef.restart();
    await clef.send('configure switch again');
    if (choice === 'never') {
      await expect
        .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
        .toContain('Rejected.');
      expect((await clef.snapshot()).permissions).toEqual([]);
    } else {
      await expect.poll(async () => (await clef.snapshot()).permissions.length).toBe(1);
      const next = (await clef.snapshot()).permissions[0];
      await clef.request.post(`/api/conversation/permissions/${next?.id}`, {
        data: {
          choice: 'deny',
        },
      });
    }
    expect((await clef.settings()).active.models).toEqual(before.active.models);
  });
}

for (const interruption of [
  'stop',
  'restart',
]) {
  test(`${interruption} invalidates pending approvals without replaying the change`, async ({
    clef,
  }) => {
    await clef.connect();
    const before = await clef.settings();
    await clef.send('configure switch');
    await expect.poll(async () => (await clef.snapshot()).permissions.length).toBe(1);
    const pending = await clef.snapshot();
    if (interruption === 'stop')
      await clef.request.post('/api/conversation/stop', {
        data: {},
      });
    else await clef.restart();
    await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
    expect((await clef.snapshot()).permissions).toEqual([]);
    expect(
      (
        await clef.request.post(`/api/conversation/permissions/${pending.permissions[0]?.id}`, {
          data: {
            choice: 'always',
          },
        })
      ).status(),
    ).toBe(409);
    expect(await clef.settings()).toEqual(before);
    expect((await clef.snapshot()).conversation.model.modelId).toBe('test-model');
    await clef.send('Still here');
    await expect
      .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
      .toBe('Clef heard: Still here');
  });
}

test('rejects a stale approval after an overlapping settings edit', async ({ clef }) => {
  await clef.connect();
  await clef.send('configure switch');
  await expect.poll(async () => (await clef.snapshot()).permissions.length).toBe(1);
  const pending = (await clef.snapshot()).permissions[0];
  const view = await clef.settings();
  expect(
    (
      await clef.request.put('/api/models/default', {
        data: {
          ...view.active.models.defaults,
          modelId: 'second-model',
          revision: view.revision,
        },
      })
    ).ok(),
  ).toBe(true);
  const changed = await clef.settings();
  await clef.request.post(`/api/conversation/permissions/${pending?.id}`, {
    data: {
      choice: 'once',
    },
  });
  await expect
    .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
    .toContain('Configuration finished on test-model. Rejected.');
  expect(await clef.settings()).toEqual(changed);
  expect((await clef.snapshot()).conversation.model.modelId).toBe('test-model');
});

test('Always persists only the displayed model, conversation and switch scope', async ({
  clef,
}) => {
  await clef.connect();
  await clef.send('configure defaults only');
  await expect.poll(async () => (await clef.snapshot()).permissions.length).toBe(1);
  const pending = (await clef.snapshot()).permissions[0];
  expect(pending).toMatchObject({
    switchConversation: false,
  });
  await clef.request.post(`/api/conversation/permissions/${pending?.id}`, {
    data: {
      choice: 'always',
    },
  });
  await expect
    .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
    .toContain('Configuration finished on test-model. Applied.');
  await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
  await clef.restart();
  await clef.send('configure defaults only again');
  await expect
    .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
    .toContain('Configuration finished on second-model. Applied.');
  expect((await clef.snapshot()).permissions).toEqual([]);
  for (const text of [
    'configure original defaults only',
    'configure switch',
  ]) {
    await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
    await clef.send(text);
    await expect.poll(async () => (await clef.snapshot()).permissions.length).toBe(1);
    const next = (await clef.snapshot()).permissions[0];
    await clef.request.post(`/api/conversation/permissions/${next?.id}`, {
      data: {
        choice: 'deny',
      },
    });
    await expect
      .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
      .toContain('Rejected.');
  }
  expect((await clef.settings()).active.permissions).toHaveLength(1);
});

test('requires approval and switches the persistent conversation at the next model request', async ({
  clef,
}) => {
  await clef.connect();
  const original = await clef.snapshot();
  await clef.send('configure switch');
  await expect.poll(async () => (await clef.snapshot()).permissions.length).toBe(1);
  expect((await clef.settings()).active.models.defaults?.modelId).toBe('test-model');
  const pending = (await clef.snapshot()).permissions[0];
  await clef.request.post(`/api/conversation/permissions/${pending?.id}`, {
    data: {
      choice: 'once',
    },
  });
  await expect
    .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
    .toContain('Configuration finished on second-model. Applied.');
  expect((await clef.settings()).active.models.defaults?.modelId).toBe('second-model');
  expect((await clef.snapshot()).conversation.id).toBe(original.conversation.id);
  await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
  await clef.restart();
  await clef.send('configure switch again');
  await expect.poll(async () => (await clef.snapshot()).permissions.length).toBe(1);
});
