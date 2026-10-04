import { afterEach, expect, it, vi } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openPermissions } from './index.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('blocks by default, consumes one-time approval, and persists an origin grant', async () => {
  const installation = await testInstallation();
  const permissions = await openPermissions(installation.database);
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
  await permissions.decide(request.id, 'once');
  await first;
  const second = permissions.authorize('chat', 'https://example.com/two', signal);
  await vi.waitFor(() => expect(permissions.pending('chat')).toHaveLength(1));
  const next = permissions.pending('chat')[0];
  if (!next) throw new Error('Expected a second permission request');
  await permissions.decide(next.id, 'always');
  await second;
  const reopened = await openPermissions(installation.database);
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
