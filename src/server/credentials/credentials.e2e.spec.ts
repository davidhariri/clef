import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '../../../tests/api.js';

test('locks after key loss, blocks model access, and restores with the original key', async ({
  clef,
}) => {
  await clef.connect();
  const path = join(clef.home, 'secrets', 'encryption.key');
  const key = await readFile(path, 'utf8');
  await rm(path);
  await clef.restart();
  expect((await (await clef.request.get('/api/status')).json()).phase).toBe('locked');
  expect((await clef.request.get('/api/models')).status()).toBe(423);
  expect(
    (
      await clef.request.post('/api/credentials/recover', {
        data: {
          key: 'b'.repeat(64),
        },
      })
    ).ok(),
  ).toBe(false);
  expect(
    (
      await clef.request.post('/api/credentials/recover', {
        data: {
          key,
        },
      })
    ).ok(),
  ).toBe(true);
  await clef.send('Unlocked');
  await expect
    .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
    .toBe('Clef heard: Unlocked');
  await clef.restart();
  expect((await (await clef.request.get('/api/status')).json()).phase).toBe('ready');
});
