import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '../../../tests/browser.js';

test('persists defaults in YAML and reloads a complete valid replacement', async ({
  page,
  clef,
}) => {
  await clef.setup();
  const path = join(clef.home, 'settings.yaml');
  const source = await readFile(path, 'utf8');
  expect(source).toContain('modelId: test-model');
  expect(source).not.toContain('test-api-key');
  await writeFile(path, source.replace('modelId: test-model', 'modelId: second-model'));
  const catalog = await page.request.get(`${clef.url}/api/models`);
  expect((await catalog.json()).defaults.modelId).toBe('second-model');
  await clef.restart();
  expect((await (await page.request.get(`${clef.url}/api/models`)).json()).defaults.modelId).toBe(
    'second-model',
  );
});

test('rejects malformed and semantically invalid revisions without partial activation', async ({
  page,
  clef,
}) => {
  await clef.setup();
  const path = join(clef.home, 'settings.yaml');
  const source = await readFile(path, 'utf8');
  for (const invalid of [
    'models: [',
    source.replace('modelId: test-model', 'modelId: missing'),
    source
      .replace(
        'permissions: []',
        'permissions:\n  - origin: https://example.com\n    method: POST\n    decision: allow',
      )
      .replace('modelId: test-model', 'modelId: second-model'),
    source.replace('provider:openai', 'provider:anthropic'),
    `${source}\nsecret: synthetic-private-token\n`,
  ]) {
    await writeFile(path, invalid);
    const catalog = await (await page.request.get(`${clef.url}/api/models`)).json();
    expect(catalog.defaults.modelId).toBe('test-model');
    expect(catalog.configurationError).toBeTruthy();
    expect(JSON.stringify(catalog)).not.toContain('synthetic-private-token');
    const rejected = await page.request.put(`${clef.url}/api/models/default`, {
      data: {
        ...catalog.defaults,
        revision: catalog.revision,
      },
    });
    expect(rejected.status()).toBe(409);
  }
  await writeFile(path, source);
  const catalog = await (await page.request.get(`${clef.url}/api/models`)).json();
  expect(catalog.configurationError).toBeNull();
  const responses = await Promise.all(
    [
      'second-model',
      'second-model',
    ].map((modelId) =>
      page.request.put(`${clef.url}/api/models/default`, {
        data: {
          ...catalog.defaults,
          modelId,
          revision: catalog.revision,
        },
      }),
    ),
  );
  expect(responses.map((response) => response.status()).sort()).toEqual([
    200,
    409,
  ]);
});

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
  await page
    .getByRole('button', {
      name: 'New conversation',
      exact: true,
    })
    .click();
  await expect(page.locator('header')).toContainText('second-model');
});

test('changes defaults only for new conversations and replaces a provider connection', async ({
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
  await page
    .getByRole('button', {
      name: 'New conversation',
      exact: true,
    })
    .click();
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
