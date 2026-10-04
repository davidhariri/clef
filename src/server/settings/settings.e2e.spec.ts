import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '../../../tests/browser.js';
import { settingsViewSchema } from './contract.js';

test('protects settings inspection, validation and replacement with authentication', async ({
  page,
  request,
  clef,
}) => {
  await clef.setup();
  const view = await (await page.request.get(`${clef.url}/api/settings`)).json();
  const source = await readFile(join(clef.home, 'settings.yaml'), 'utf8');
  expect((await request.get(`${clef.url}/api/settings`)).status()).toBe(401);
  expect(
    (
      await request.post(`${clef.url}/api/settings/validate`, {
        data: {
          source,
        },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.put(`${clef.url}/api/settings`, {
        data: {
          source,
          revision: view.revision,
        },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.put(`${clef.url}/api/settings`, {
        data: {
          source,
          revision: view.revision,
        },
        headers: {
          origin: 'https://untrusted.example',
        },
      })
    ).status(),
  ).toBe(403);
  expect(await (await page.request.get(`${clef.url}/api/settings`)).json()).toEqual(view);
});

test('rejects unsafe YAML as a complete revision and reports no raw source', async ({
  page,
  clef,
}) => {
  await clef.setup();
  const path = join(clef.home, 'settings.yaml');
  const source = await readFile(path, 'utf8');
  const original = settingsViewSchema.parse(
    await (await page.request.get(`${clef.url}/api/settings`)).json(),
  );
  const marker = 'synthetic-private-marker';
  for (const invalid of [
    `${source}\nversion: 1\n`,
    source.replace('permissions: []', 'permissions: &policy [*policy]'),
    source.replace('permissions: []', `permissions: !unsafe ${marker}`),
    source.replace('secretRef: provider:openai', `secretRef: ${marker}`),
    source.replace(
      'permissions: []',
      'permissions:\n  - origin: https://example.com\n    method: GET\n    decision: allow\n  - origin: https://example.com\n    method: GET\n    decision: deny',
    ),
    `${source}\nendpoint: https://untrusted.example/${marker}\n`,
  ]) {
    const validation = await page.request.post(`${clef.url}/api/settings/validate`, {
      data: {
        source: invalid,
      },
    });
    expect(validation.status()).toBe(400);
    expect(await validation.text()).not.toContain(marker);
    const update = await page.request.put(`${clef.url}/api/settings`, {
      data: {
        source: invalid,
        revision: original.revision,
      },
    });
    expect(update.status()).toBe(400);
    expect(await readFile(path, 'utf8')).toBe(source);
    await writeFile(path, invalid);
    const view = settingsViewSchema.parse(
      await (await page.request.get(`${clef.url}/api/settings`)).json(),
    );
    expect(view.active).toEqual(original.active);
    expect(view.revision).toBe(original.revision);
    expect(view.error).toBeTruthy();
    expect(view.error).not.toContain(marker);
    await writeFile(path, source);
  }
  expect(await (await page.request.get(`${clef.url}/api/settings`)).json()).toEqual(original);
});

test('bounds file and HTTP input and refuses symlink replacements', async ({ page, clef }) => {
  await clef.setup();
  const path = join(clef.home, 'settings.yaml');
  const source = await readFile(path, 'utf8');
  const original = settingsViewSchema.parse(
    await (await page.request.get(`${clef.url}/api/settings`)).json(),
  );
  const large = `${source}#${'x'.repeat(65536)}`;
  expect(
    (
      await page.request.post(`${clef.url}/api/settings/validate`, {
        data: {
          source: large,
        },
      })
    ).status(),
  ).toBe(413);
  await writeFile(path, large);
  const rejected = settingsViewSchema.parse(
    await (await page.request.get(`${clef.url}/api/settings`)).json(),
  );
  expect(rejected.active).toEqual(original.active);
  expect(rejected.error).toContain('64 KiB');
  const target = join(clef.home, 'external.yaml');
  await writeFile(target, source.replace('modelId: test-model', 'modelId: second-model'));
  await rm(path);
  await symlink(target, path);
  const linked = settingsViewSchema.parse(
    await (await page.request.get(`${clef.url}/api/settings`)).json(),
  );
  expect(linked.active).toEqual(original.active);
  expect(linked.error).toContain('Cannot read settings.yaml');
  expect(
    (
      await page.request.put(`${clef.url}/api/settings`, {
        data: {
          source,
          revision: original.revision,
        },
      })
    ).status(),
  ).toBe(409);
  expect(await readFile(target, 'utf8')).toContain('modelId: second-model');
  await rm(path);
  await writeFile(path, source);
  expect(await (await page.request.get(`${clef.url}/api/settings`)).json()).toEqual(original);
});

test('refuses a named pipe without blocking server startup', async () => {
  const home = await mkdtemp(join(tmpdir(), 'clef-pipe-settings-'));
  try {
    await promisify(execFile)('mkfifo', [
      join(home, 'settings.yaml'),
    ]);
    await expect(
      promisify(execFile)(
        process.execPath,
        [
          'lib/server/main.js',
        ],
        {
          env: {
            ...process.env,
            CLEF_HOME: home,
          },
          timeout: 3000,
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('must be a regular file'),
    });
  } finally {
    await rm(home, {
      recursive: true,
      force: true,
    });
  }
});

test('refuses startup with an invalid initial permission policy', async () => {
  const home = await mkdtemp(join(tmpdir(), 'clef-invalid-settings-'));
  try {
    await writeFile(
      join(home, 'settings.yaml'),
      'version: 1\nmodels:\n  defaults: null\n  connections: []\npermissions:\n  - decision: allow\n',
    );
    await expect(
      promisify(execFile)(
        process.execPath,
        [
          'lib/server/main.js',
        ],
        {
          env: {
            ...process.env,
            CLEF_HOME: home,
          },
          timeout: 10000,
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('No valid configuration is active.'),
    });
  } finally {
    await rm(home, {
      recursive: true,
      force: true,
    });
  }
});
