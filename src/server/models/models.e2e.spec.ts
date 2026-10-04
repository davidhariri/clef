import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '../../../tests/browser.js';

test('reloads settings without interrupting a pinned model stream or its SSE connection', async ({
  page,
  clef,
}) => {
  await clef.setup();
  await page.goto(clef.url);
  await page.getByPlaceholder('Message Clef…').fill('Please send a slow response');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  const reply = page
    .getByRole('article', {
      name: 'Clef reply',
    })
    .last();
  await expect(reply).toContainText('A slow');
  const path = join(clef.home, 'settings.yaml');
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace('modelId: test-model', 'modelId: second-model'));
  const catalog = await (await page.request.get(`${clef.url}/api/models`)).json();
  expect(catalog.defaults.modelId).toBe('second-model');
  const length = (await reply.innerText()).length;
  await expect.poll(async () => (await reply.innerText()).length).toBeGreaterThan(length);
  await expect(page.locator('header')).toContainText('test-model');
  await expect(
    page.getByText('Reconnecting…', {
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole('button', {
      name: 'Stop reply',
    })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Stop reply',
    }),
  ).toHaveCount(0);
  await page.getByPlaceholder('Message Clef…').fill('Use the saved model');
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
      .last(),
  ).toContainText('Clef heard: Use the saved model');
  await expect(page.locator('header')).toContainText('second-model');
});

test('applies model changes to the next message and replaces a provider connection', async ({
  page,
  clef,
}) => {
  await clef.setup();
  await page.goto(clef.url);
  await expect(
    page.getByText('test-model', {
      exact: true,
    }),
  ).toBeVisible();
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
      name: 'Second model',
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
  await page.getByPlaceholder('Message Clef…').fill('Use the selected model');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText('Clef heard: Use the selected model');
  await expect(
    page.getByText('second-model', {
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
    .getByText('Use an API key instead', {
      exact: true,
    })
    .click();
  await page
    .getByLabel('API key', {
      exact: true,
    })
    .fill('replacement-test-api-key');
  await page
    .getByRole('button', {
      name: 'Connect provider',
    })
    .click();
  await expect(
    page.getByRole('dialog', {
      name: 'Settings',
    }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText('second-model', {
      exact: true,
    }),
  ).toBeVisible();
});
