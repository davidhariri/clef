import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '../../../tests/browser.js';

test('locks after key loss, blocks model access, and restores with the saved key', async ({
  page,
  clef,
}) => {
  await clef.setup();
  const catalog = await page.request.get(`${clef.url}/api/models`);
  expect(await catalog.text()).not.toContain('test-api-key');
  await rm(join(clef.home, 'secrets', 'encryption.key'));
  await clef.restart();
  await page.goto(clef.url);
  await expect(
    page.getByRole('heading', {
      name: 'Unlock your connections.',
    }),
  ).toBeVisible();
  expect((await page.request.get(`${clef.url}/api/models`)).status()).toBe(423);
  expect(
    (
      await page.request.post(`${clef.url}/api/conversation/messages`, {
        data: {},
      })
    ).status(),
  ).toBe(423);
  await page.getByLabel('Encryption key').fill('b'.repeat(64));
  await page
    .getByRole('button', {
      name: 'Unlock',
      exact: true,
    })
    .click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Encryption key').fill('a'.repeat(64));
  await page
    .getByRole('button', {
      name: 'Unlock',
      exact: true,
    })
    .click();
  await expect(page.getByPlaceholder('Message Clef…')).toBeVisible();
  await clef.restart();
  await page.reload();
  await expect(page.getByPlaceholder('Message Clef…')).toBeVisible();
});
