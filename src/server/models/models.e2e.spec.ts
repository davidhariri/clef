import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '../../../tests/api.js';
import type { ConversationSnapshot } from '../messages/contract.js';

test('reloads settings without interrupting a pinned model stream or its SSE connection', async ({
  clef,
}) => {
  await clef.connect();
  const client = clef.client;
  const abort = new AbortController();
  const updates: ConversationSnapshot[] = [];
  let connections = 0;
  const stream = client.watch(
    abort.signal,
    (view) => updates.push(view),
    (error) => {
      if (!error) connections++;
    },
  );
  try {
    await expect.poll(() => updates.length).toBeGreaterThan(0);
    await clef.send('slow');
    await expect.poll(() => updates.at(-1)?.messages.at(-1)?.text.length ?? 0).toBeGreaterThan(6);
    const path = join(clef.home, 'settings.yaml');
    const source = await readFile(path, 'utf8');
    await writeFile(path, source.replace('modelId: test-model', 'modelId: second-model'));
    expect((await clef.settings()).active.models.defaults?.modelId).toBe('second-model');
    const length = updates.at(-1)?.messages.at(-1)?.text.length ?? 0;
    await expect
      .poll(() => updates.at(-1)?.messages.at(-1)?.text.length ?? 0)
      .toBeGreaterThan(length);
    expect(updates.at(-1)?.conversation.model.modelId).toBe('test-model');
    expect(connections).toBe(1);
    await clef.request.post('/api/conversation/stop', {
      data: {},
    });
    await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
    await clef.send('Use saved model');
    await expect
      .poll(() => updates.at(-1)?.messages.at(-1)?.text)
      .toBe('Clef heard: Use saved model');
    expect(updates.at(-1)?.conversation.model.modelId).toBe('second-model');
  } finally {
    abort.abort();
    await stream;
  }
});

test('replaces an encrypted provider connection without resetting defaults', async ({ clef }) => {
  await clef.connect();
  const view = await clef.settings();
  await clef.request.put('/api/models/default', {
    data: {
      provider: 'openai',
      modelId: 'second-model',
      thinkingLevel: 'off',
      revision: view.revision,
    },
  });
  await clef.request.post('/api/models/key', {
    data: {
      provider: 'openai',
      key: 'replacement-test-api-key',
    },
  });
  await clef.restart();
  expect((await clef.settings()).active.models.defaults?.modelId).toBe('second-model');
  expect(
    (await readFile(join(clef.home, 'state', 'clef.sqlite'))).includes(
      Buffer.from('replacement-test-api-key'),
    ),
  ).toBe(false);
  await clef.send('Still connected');
  await expect
    .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
    .toBe('Clef heard: Still connected');
});
