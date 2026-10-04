import { afterEach, expect, it, vi } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openPermissions } from './index.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('expires a configuration request and rejects late decisions without saving a rule', async () => {
  const installation = await testInstallation();
  await installation.settings.initialize(async () => undefined);
  const permissions = await openPermissions(installation.database, installation.settings);
  cleanups.push(async () => {
    permissions.close();
    await installation.dispose();
  });
  const before = await installation.settings.view();
  vi.useFakeTimers();
  const change = {
    revision: before.revision,
    defaults: {
      provider: 'openai',
      modelId: 'test-model',
      thinkingLevel: 'off' as const,
    },
    switchConversation: true,
  };
  const authorized = permissions.authorizeConfiguration(
    'chat',
    'call',
    change,
    new AbortController().signal,
  );
  const rejected = expect(authorized).rejects.toThrow('cancelled or expired');
  await vi.waitFor(() => expect(permissions.pending('chat')).toHaveLength(1));
  const pending = permissions.pending('chat')[0];
  if (!pending) throw new Error('Expected a configuration request');
  await expect(
    permissions.authorizeConfiguration('chat', 'duplicate', change, new AbortController().signal),
  ).rejects.toThrow('already pending');
  await vi.advanceTimersByTimeAsync(120_000);
  await rejected;
  expect(permissions.pending('chat')).toEqual([]);
  await expect(permissions.decide(pending.id, 'always', 'chat')).rejects.toThrow(
    'no longer active',
  );
  expect(await installation.settings.view()).toEqual(before);
});

it('blocks by default, consumes one-time approval, and persists an origin grant', async () => {
  const installation = await testInstallation();
  await installation.settings.initialize(async () => undefined);
  const permissions = await openPermissions(installation.database, installation.settings);
  cleanups.push(async () => {
    permissions.close();
    await installation.dispose();
  });
  const signal = new AbortController().signal;
  let completed = false;
  const first = permissions.authorize('chat', 'https://example.com/one', signal).then(() => {
    completed = true;
  });
  await vi.waitFor(() => expect(permissions.pending('chat')).toHaveLength(1));
  expect(completed).toBe(false);
  const request = permissions.pending('chat')[0];
  if (!request) throw new Error('Expected a permission request');
  await permissions.decide(request.id, 'once', 'chat');
  await first;
  const second = permissions.authorize('chat', 'https://example.com/two', signal);
  await vi.waitFor(() => expect(permissions.pending('chat')).toHaveLength(1));
  const next = permissions.pending('chat')[0];
  if (!next) throw new Error('Expected a second permission request');
  await permissions.decide(next.id, 'always', 'chat');
  await second;
  const reopened = await openPermissions(installation.database, installation.settings);
  await reopened.authorize('chat', 'https://example.com/three', signal);
  reopened.close();
  expect(await permissions.rules()).toEqual([
    {
      origin: 'https://example.com',
      method: 'GET',
      decision: 'allow',
    },
  ]);
});
