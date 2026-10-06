import { expect, test } from '../../../tests/api.js';
import { type ConversationSnapshot, snapshotSchema } from './contract.js';

test('streams one persistent conversation to concurrent clients and reconnects after restart', async ({
  clef,
}) => {
  await clef.connect();
  const first: ConversationSnapshot[] = [];
  const second: ConversationSnapshot[] = [];
  const abort = new AbortController();
  const client = clef.client;
  const streams = [
    client.watch(
      abort.signal,
      (view) => first.push(view),
      () => {},
    ),
    client.watch(
      abort.signal,
      (view) => second.push(view),
      () => {},
    ),
  ];
  try {
    await expect.poll(() => first.length > 0 && second.length > 0).toBe(true);
    await clef.send('Hello');
    await expect.poll(() => first.at(-1)?.messages.at(-1)?.text).toBe('Clef heard: Hello');
    await expect.poll(() => second.at(-1)?.messages.at(-1)?.text).toBe('Clef heard: Hello');
    const id = first.at(-1)?.conversation.id;
    expect(second.at(-1)?.conversation.id).toBe(id);
    await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
    await clef.restart();
    await clef.send('After restart');
    await expect.poll(() => first.at(-1)?.messages.at(-1)?.text).toBe('Clef heard: After restart');
    expect(first.at(-1)?.conversation.id).toBe(id);
    expect(first.at(-1)?.messages.some((message) => message.text === 'Clef heard: Hello')).toBe(
      true,
    );
  } finally {
    abort.abort();
    await Promise.all(streams);
  }
});

test('keeps a new main chat across restart when a first client connects at the same time', async ({
  clef,
}) => {
  await clef.connect();
  const [created] = await Promise.all([
    clef.request.post('/api/conversations', {
      data: {},
    }),
    clef.snapshot(),
  ]);
  const main = await created.json();
  expect((await clef.snapshot()).conversation.id).toBe(main.id);
  await clef.restart();
  expect((await clef.snapshot()).conversation.id).toBe(main.id);
});

test('main followers move to new chats while pinned streams keep their active reply', async ({
  clef,
}) => {
  await clef.connect();
  const original = (await clef.snapshot()).conversation.id;
  let following: ConversationSnapshot | undefined;
  let pinned: ConversationSnapshot | undefined;
  const abort = new AbortController();
  const streams = [
    clef.client.watch(
      abort.signal,
      (snapshot) => {
        following = snapshot;
      },
      () => {},
    ),
    clef.client.watch(
      abort.signal,
      (snapshot) => {
        pinned = snapshot;
      },
      () => {},
      original,
    ),
  ];
  try {
    await expect.poll(() => following?.conversation.id).toBe(original);
    await expect.poll(() => pinned?.conversation.id).toBe(original);
    await clef.send('slow history reply');
    await expect.poll(() => pinned?.busy).toBe(true);
    const created = await (
      await clef.request.post('/api/conversations', {
        data: {},
      })
    ).json();
    await expect.poll(() => following?.conversation.id).toBe(created.id);
    expect(pinned?.conversation.id).toBe(original);
    expect(pinned?.busy).toBe(true);
    const length = pinned?.messages.at(-1)?.text.length ?? 0;
    await expect.poll(() => pinned?.messages.at(-1)?.text.length ?? 0).toBeGreaterThan(length);
    await clef.request.post('/api/conversation/stop', {
      data: {},
    });
    expect((await (await clef.request.get(`/api/conversation?id=${original}`)).json()).busy).toBe(
      true,
    );
  } finally {
    abort.abort();
    await Promise.all(streams);
  }
});

test('creates a main conversation while older replies run and searches history without changing main', async ({
  clef,
}) => {
  await clef.connect();
  await clef.send('slow road trip');
  const original = (await clef.snapshot()).conversation.id;
  const read = async (id: string) =>
    snapshotSchema.parse(await (await clef.request.get(`/api/conversation?id=${id}`)).json());
  const created = await clef.request.post('/api/conversations', {
    data: {},
  });
  expect(created.status()).toBe(200);
  const second = (await created.json()).id;
  expect(second).not.toBe(original);
  expect((await clef.snapshot()).conversation.id).toBe(second);
  expect((await read(original)).busy).toBe(true);
  await clef.send('Garden plans');
  await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
  const third = await (
    await clef.request.post('/api/conversations', {
      data: {},
    })
  ).json();
  expect(
    (
      await clef.request.post(`/api/conversation/stop?id=${original}`, {
        data: {},
      })
    ).ok(),
  ).toBe(true);
  const continued = await clef.request.post(`/api/conversation/messages?id=${second}`, {
    data: {
      text: 'Garden update',
      requestId: crypto.randomUUID(),
    },
  });
  expect(continued.ok()).toBe(true);
  await expect
    .poll(async () => (await read(second)).messages.at(-1)?.text)
    .toBe('Clef heard: Garden update');
  const history = await (await clef.request.get('/api/conversations')).json();
  expect(history.conversations.map((item: { id: string }) => item.id)).toEqual([
    third.id,
    second,
    original,
  ]);
  expect(history.conversations[0]).toMatchObject({
    main: true,
    title: 'New conversation',
  });
  const filtered = await (await clef.request.get('/api/conversations?query=road')).json();
  expect(filtered.conversations.map((item: { id: string }) => item.id)).toEqual([
    third.id,
    original,
  ]);
  expect(filtered.conversations[1].title).toBe('slow road trip');
  expect((await clef.snapshot()).conversation.id).toBe(third.id);
  expect((await clef.request.get('/api/conversation?id=999999')).status()).toBe(404);
  await clef.restart();
  expect((await clef.snapshot()).conversation.id).toBe(third.id);
  expect((await read(second)).messages.at(-1)?.text).toBe('Clef heard: Garden update');
});

test('stops a live reply and accepts another message', async ({ clef }) => {
  await clef.connect();
  await clef.send('slow');
  await expect
    .poll(async () => (await clef.snapshot()).messages.at(-1)?.text.length ?? 0)
    .toBeGreaterThan(6);
  expect(
    (
      await clef.request.post('/api/conversation/stop', {
        data: {},
      })
    ).ok(),
  ).toBe(true);
  await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
  await clef.send('Again');
  await expect
    .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
    .toBe('Clef heard: Again');
});
