import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { afterEach, expect, it, vi } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openAgent } from '../agent/index.js';
import { openCredentials } from '../credentials/index.js';
import { openModels } from '../models/index.js';
import { openPermissions } from '../permissions/index.js';
import { openTelegram } from './index.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

async function setup(reply = 'Hello from Clef.', tokensPerSecond = 10000) {
  const installation = await testInstallation();
  const credentials = await openCredentials(installation.database, installation.keyPath);
  await credentials.initializeKey('a'.repeat(64));
  const provider = fauxProvider({
    provider: 'test',
    models: [
      {
        id: 'test-model',
      },
    ],
    tokensPerSecond,
  });
  provider.setResponses([
    fauxAssistantMessage(reply),
    fauxAssistantMessage('A second reply.'),
  ]);
  const models = await openModels(installation.database, credentials.store, installation.settings, [
    provider.provider,
  ]);
  await installation.settings.initialize((configuration) =>
    models.validateConfiguration(configuration),
  );
  const permissions = await openPermissions(installation.database, installation.settings);
  await models.saveDefaults({
    provider: 'test',
    modelId: 'test-model',
    thinkingLevel: 'off',
  });
  const agent = await openAgent(installation.database, models, installation.settings, permissions);
  const updates: unknown[] = [];
  const sent: Array<{
    chat_id: number;
    text: string;
  }> = [];
  const calls: string[] = [];
  const offsets: number[] = [];
  const faults = {
    send: false,
    webhook: false,
    rateLimit: false,
  };
  const sendResponse = (
    body: {
      chat_id: number;
      text: string;
    },
    url: string,
  ) => {
    if (faults.rateLimit) {
      faults.rateLimit = false;
      return Response.json(
        {
          ok: false,
          error_code: 429,
          parameters: {
            retry_after: 1,
          },
        },
        {
          status: 429,
        },
      );
    }
    sent.push(body);
    if (faults.send) throw new Error(`Lost response for ${url}`);
    return Response.json({
      ok: true,
      result: {
        message_id: sent.length,
      },
    });
  };
  const transport: typeof fetch = async (input, init) => {
    const method = String(input).split('/').at(-1) ?? '';
    calls.push(method);
    const body = JSON.parse(String(init?.body));
    let result: unknown;
    if (method === 'getMe')
      result = {
        id: 123,
        is_bot: true,
        username: 'clef_test_bot',
      };
    if (method === 'getWebhookInfo')
      result = {
        url: faults.webhook ? 'https://example.com/webhook' : '',
      };
    if (method === 'getUpdates') {
      offsets.push(body.offset);
      result = updates
        .filter(
          (item) =>
            (
              item as {
                update_id: number;
              }
            ).update_id >= body.offset,
        )
        .slice(0, 20);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (method === 'sendMessage') return sendResponse(body, String(input));
    return Response.json({
      ok: true,
      result,
    });
  };
  const options = {
    ...installation,
    credentials,
    agent,
    models,
    fetch: transport,
  };
  const telegram = await openTelegram(options);
  cleanups.push(async () => {
    await telegram.close();
    permissions.close();
    await agent.close();
    await credentials.close();
    await installation.dispose();
  });

  return {
    telegram,
    updates,
    sent,
    calls,
    offsets,
    agent,
    options,
    faults,
  };
}

async function pair(telegram: Awaited<ReturnType<typeof openTelegram>>, updates: unknown[]) {
  const pairing = await telegram.connect('123:abcdefghijklmnopqrstuvwxyz');
  const code = new URL(pairing.url).searchParams.get('start');
  updates.push(message(1, `/start ${code}`));
  await vi.waitFor(async () => expect((await telegram.status()).ownerId).toBe(42));
}

function message(updateId: number, text: string, sender = 42, type = 'private') {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: {
        id: sender,
        is_bot: false,
      },
      chat: {
        id: sender,
        type,
      },
      text,
    },
  };
}

it('rejects expired pairing links and accepts a newly issued link', async () => {
  const { telegram, updates, offsets } = await setup();
  const pairing = await telegram.connect('123:abcdefghijklmnopqrstuvwxyz');
  const code = new URL(pairing.url).searchParams.get('start');
  const now = Date.now;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + 600_001);
  try {
    updates.push(message(1, `/start ${code}`, 99));
    await vi.waitFor(() => expect(offsets).toContain(2));
    expect((await telegram.status()).ownerId).toBeUndefined();
    const fresh = telegram.pair();
    updates.push(message(2, `/start ${new URL(fresh.url).searchParams.get('start')}`));
    await vi.waitFor(async () => expect((await telegram.status()).ownerId).toBe(42));
  } finally {
    clock.mockRestore();
  }
});

it('makes no external requests while the credential store is locked and resumes after recovery', async () => {
  const { telegram, options, updates, calls } = await setup();
  await pair(telegram, updates);
  await telegram.close();
  await rm(options.keyPath);
  const locked = await openCredentials(options.database, options.keyPath);
  const restored = await openTelegram({
    ...options,
    credentials: locked,
  });
  try {
    const count = calls.length;
    await vi.waitFor(async () =>
      expect((await restored.status()).error).toContain('encrypted token'),
    );
    expect(calls).toHaveLength(count);
    expect((await restored.status()).state).toBe('disconnected');
    await locked.recover('a'.repeat(64));
    await vi.waitFor(async () => expect((await restored.status()).ownerId).toBe(42), {
      timeout: 5000,
    });
  } finally {
    await restored.close();
    await locked.close();
  }
});

it('resumes waiting for the admitted message without starting another model reply', async () => {
  const answer = 'A response that takes time to generate. '.repeat(5);
  const { telegram, options, updates, sent, agent } = await setup(answer, 50);
  await pair(telegram, updates);
  updates.push(message(2, 'One request'));
  await vi.waitFor(async () => expect((await agent.snapshot()).busy).toBe(true));
  await telegram.close();
  const restored = await openTelegram(options);
  try {
    await vi.waitFor(() => expect(sent.map((item) => item.text)).toContain(answer), {
      timeout: 5000,
    });
    expect((await agent.snapshot()).messages.filter((item) => item.role === 'user')).toHaveLength(
      1,
    );
    expect(sent.filter((item) => item.text === answer)).toHaveLength(1);
  } finally {
    await restored.close();
  }
});

it('splits long replies into plain text messages without breaking emoji', async () => {
  const answer = `${'x'.repeat(3999)}🙂${'y'.repeat(4100)}`;
  const { telegram, updates, sent } = await setup(answer);
  await pair(telegram, updates);
  updates.push(message(2, 'Long reply'));
  await vi.waitFor(() => expect(sent).toHaveLength(4), {
    timeout: 3000,
  });
  const replies = sent.slice(1);
  expect(replies.map((item) => item.text).join('')).toBe(answer);
  expect(
    replies.every(
      (item) => item.text.length <= 4000 && Buffer.from(item.text).toString('utf8') === item.text,
    ),
  ).toBe(true);
});

it('keeps Telegram control messages and unsupported media out of model context', async () => {
  const { telegram, updates, sent, agent } = await setup();
  await pair(telegram, updates);
  updates.push(message(2, '/start'));
  await vi.waitFor(() =>
    expect(sent.map((item) => item.text)).toContain(
      'This Telegram account is already connected to Clef.',
    ),
  );
  const voice = message(3, '');
  updates.push(voice);
  await vi.waitFor(() => expect(sent.some((item) => item.text.includes('text only'))).toBe(true));
  expect(await agent.reply(crypto.randomUUID())).toEqual({
    state: 'missing',
  });
  await expect(agent.snapshot()).rejects.toThrow('Open the conversation first');
});

it('stops reading an oversized Telegram response before buffering the full body', async () => {
  const { telegram, options, updates } = await setup();
  await pair(telegram, updates);
  await telegram.close();
  let chunks = 0;
  let cancelled = false;
  const restored = await openTelegram({
    ...options,
    fetch: async (input, init) => {
      if (!String(input).endsWith('/getUpdates')) return options.fetch(input, init);
      return new Response(
        new ReadableStream({
          pull(controller) {
            chunks += 1;
            controller.enqueue(new Uint8Array(64 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    },
  });
  try {
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(chunks).toBeLessThanOrEqual(10);
    expect((await restored.status()).error).toContain('Cannot reach Telegram');
  } finally {
    await restored.close();
  }
});

it('disconnects without retaining the bot token or accepting more updates', async () => {
  const { telegram, options, updates, calls } = await setup();
  await pair(telegram, updates);
  const configuration = await readFile(join(options.home, 'telegram.json'), 'utf8');
  expect(configuration).not.toContain('abcdefghijklmnopqrstuvwxyz');
  const { credentialId } = JSON.parse(configuration);
  expect(await options.credentials.store.read(credentialId)).toBeDefined();
  await telegram.disconnect();
  const count = calls.length;
  expect(await options.credentials.store.read(credentialId)).toBeUndefined();
  await expect(readFile(join(options.home, 'telegram.json'))).rejects.toThrow();
  expect((await telegram.status()).state).toBe('disconnected');
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(calls).toHaveLength(count);
});

it('retries a reply only when Telegram explicitly rejects it with a rate limit', async () => {
  const { telegram, updates, sent, faults } = await setup();
  await pair(telegram, updates);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  faults.rateLimit = true;
  updates.push(message(2, 'Hello'));
  await vi.waitFor(() => expect(sent.map((item) => item.text)).toContain('Hello from Clef.'), {
    timeout: 5000,
  });
  expect(sent.filter((item) => item.text === 'Hello from Clef.')).toHaveLength(1);
});

it('does not resend after Telegram accepted a reply but its response was lost', async () => {
  const { telegram, options, updates, sent, faults } = await setup();
  await pair(telegram, updates);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  faults.send = true;
  updates.push(message(2, 'Hello'));
  await vi.waitFor(() => expect(sent.map((item) => item.text)).toContain('Hello from Clef.'));
  await telegram.close();
  faults.send = false;
  const restored = await openTelegram(options);
  try {
    await vi.waitFor(async () =>
      expect((await restored.status()).error).toContain('will not send it again'),
    );
    expect(JSON.stringify(await restored.status())).not.toContain('abcdefghijklmnopqrstuvwxyz');
    updates.push(message(3, 'Next message'));
    await vi.waitFor(() => expect(sent.map((item) => item.text)).toContain('A second reply.'));
    expect(sent.filter((item) => item.text === 'Hello from Clef.')).toHaveLength(1);
  } finally {
    await restored.close();
  }
});

it('keeps the active connection when a file edit is invalid', async () => {
  const { telegram, options, updates, sent } = await setup();
  await pair(telegram, updates);
  await writeFile(join(options.home, 'telegram.json'), '{invalid');
  await vi.waitFor(async () => expect((await telegram.status()).error).toContain('configuration'));
  updates.push(message(2, 'Still connected'));
  await vi.waitFor(() => expect(sent.map((item) => item.text)).toContain('Hello from Clef.'));
});

it('keeps the current connection when a replacement bot has a webhook', async () => {
  const { telegram, updates, faults, sent } = await setup();
  await pair(telegram, updates);
  faults.webhook = true;
  await expect(
    telegram.connect('123:replacement_token_abcdefghijklmnopqrstuvwxyz'),
  ).rejects.toThrow('webhook');
  expect((await telegram.status()).ownerId).toBe(42);
  updates.push(message(2, 'Still connected'));
  await vi.waitFor(() => expect(sent.map((item) => item.text)).toContain('Hello from Clef.'));
});

it('shares the web conversation and does not replay an update after restart', async () => {
  const { telegram, updates, sent, agent, options } = await setup();
  await pair(telegram, updates);
  updates.push(message(2, 'Hello'), message(2, 'Hello'));
  await vi.waitFor(() => expect(sent.map((item) => item.text)).toContain('Hello from Clef.'));
  expect((await agent.snapshot()).messages.map((item) => item.text)).toEqual([
    'Hello',
    'Hello from Clef.',
  ]);
  await telegram.close();
  const restored = await openTelegram(options);
  try {
    await vi.waitFor(async () => expect((await restored.status()).ownerId).toBe(42));
    updates.push(message(2, 'Hello'), message(3, 'Another message'));
    await vi.waitFor(() => expect(sent.map((item) => item.text)).toContain('A second reply.'));
    expect(sent.filter((item) => item.text === 'Hello from Clef.')).toHaveLength(1);
    expect((await agent.snapshot()).messages.filter((item) => item.role === 'user')).toHaveLength(
      2,
    );
  } finally {
    await restored.close();
  }
});

it('makes no Telegram requests until connected and pairs only with the one-time private link', async () => {
  const { telegram, updates, sent, calls } = await setup();
  expect((await telegram.status()).state).toBe('disconnected');
  expect(calls).toEqual([]);
  const pairing = await telegram.connect('123:abcdefghijklmnopqrstuvwxyz');
  const code = new URL(pairing.url).searchParams.get('start');
  updates.push(message(1, '/start wrong'), message(2, `/start ${code}`, 42, 'group'));
  await vi.waitFor(() =>
    expect(calls.filter((call) => call === 'getUpdates').length).toBeGreaterThan(1),
  );
  expect((await telegram.status()).ownerId).toBeUndefined();
  expect(sent).toEqual([]);
  updates.push(message(3, `/start ${code}`));
  await vi.waitFor(async () => expect((await telegram.status()).ownerId).toBe(42));
  updates.push(message(4, `/start ${code}`, 99), message(5, 'Hello', 99));
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]?.chat_id).toBe(42);
  expect(JSON.stringify(await telegram.status())).not.toContain('abcdefghijklmnopqrstuvwxyz');
});
