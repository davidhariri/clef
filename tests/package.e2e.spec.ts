import { copyFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execute, expect, test } from './package.js';

function checkFiles(paths: string[]): void {
  expect(paths).toEqual(
    expect.arrayContaining([
      'package.json',
      'README.md',
      'INSTALLATION.md',
      'LICENSE',
      'lib/server/main.js',
      'dist/index.html',
      'dist/.vite/license.md',
      'src/web/components/upstream/LICENSE-AI-ELEMENTS',
      'src/web/components/upstream/LICENSE-SHADCN',
      'src/web/components/upstream/UPSTREAM.md',
    ]),
  );
  expect(
    paths.filter(
      (path) =>
        !/^(package\.json|README\.md|INSTALLATION\.md|LICENSE|lib\/server\/.+\.js|dist\/(index\.html|\.vite\/license\.md|assets\/.+)|src\/web\/components\/upstream\/(LICENSE-(AI-ELEMENTS|SHADCN)|UPSTREAM\.md))$/.test(
          path,
        ),
    ),
  ).toEqual([]);
  expect(paths.filter((path) => /\.(test|e2e\.spec)\.js$/.test(path))).toEqual([]);
}

test('installs without scripts, runs after CLI exit, and preserves the web account across updates', async ({
  page,
  installed,
}) => {
  test.setTimeout(120_000);
  const { cli, artifact, manifest, home } = installed;
  expect(artifact.name).toBe('@davidhariri/clef');
  checkFiles(artifact.files.map((file) => file.path));
  expect(manifest.license).toBe('MIT');
  expect(manifest.bin).toEqual({
    clef: 'lib/server/main.js',
  });
  expect(manifest.scripts.preinstall).toBeUndefined();
  expect(manifest.scripts.install).toBeUndefined();
  expect(manifest.scripts.postinstall).toBeUndefined();

  const started = await cli();
  const setupUrl = /Set up Clef: (http:\/\/[^\s]+)/.exec(started.stdout)?.[1];
  if (!setupUrl) throw new Error('The installed CLI must return a setup link and exit.');
  await page.goto(setupUrl);
  await expect(
    page.getByRole('button', {
      name: 'Create account',
    }),
  ).toBeVisible();
  const status = await page.request.get(new URL('/api/status', setupUrl).href);
  expect(status.ok()).toBe(true);
  expect(await status.json()).toMatchObject({
    phase: 'setup',
  });
  for (const path of [
    '/server/main.js',
    '/lib/server/main.js',
  ]) {
    const privateCode = await page.request.get(new URL(path, setupUrl).href);
    expect(privateCode.status()).toBe(404);
  }
  const firstStatus = (
    await cli([
      'status',
    ])
  ).stdout;
  expect(firstStatus).toMatch(/Clef running \(PID \d+\)/);
  expect((await cli()).stdout).toBe(started.stdout);
  expect(
    (
      await cli([
        'status',
      ])
    ).stdout,
  ).toBe(firstStatus);

  await page.getByLabel('Username').fill('package-user');
  await page
    .getByLabel('Password', {
      exact: true,
    })
    .fill('a long package test password');
  await page
    .getByRole('button', {
      name: 'Generate key',
    })
    .click();
  await page.getByLabel('I saved my recovery key').check();
  await page
    .getByRole('button', {
      name: 'Create account',
    })
    .click();
  await page
    .getByRole('button', {
      name: 'OpenAI',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Sign in with ChatGPT',
    }),
  ).toBeVisible();
  expect((await cli()).stdout).not.toContain('#setup=');

  for (const name of [
    'service.json',
    'service.log',
    'runtime.sock',
    'owner.sqlite',
  ]) {
    expect((await stat(join(home, name))).mode & 0o777).toBe(0o600);
  }
  const log = await readFile(join(home, 'service.log'), 'utf8');
  expect(log).not.toContain(new URL(setupUrl).hash.slice('#setup='.length));
  expect(log).not.toContain('Set up Clef:');
  expect((await stat(home)).mode & 0o777).toBe(0o700);
  expect((await stat(installed.config)).mode & 0o777).toBe(0o600);

  const configuration = await readFile(installed.config, 'utf8');
  const pid = /PID (\d+)/.exec(firstStatus)?.[1];
  if (!pid) throw new Error('No running service PID.');
  const processCommand = (
    await execute('ps', [
      '-p',
      pid,
      '-o',
      'command=',
    ])
  ).stdout;
  expect(processCommand).toContain(process.execPath);
  expect(processCommand).toContain(join(installed.packagePath, 'lib/server/main.js'));
  expect(configuration).toContain(
    process.platform === 'darwin' ? '<key>RunAtLoad</key><true/>' : 'WantedBy=default.target',
  );
  if (process.platform === 'linux') {
    expect((await installed.autoStartStatus()).stdout.trim()).toBe('enabled');
  }
  await installed.reload();
  await expect
    .poll(async () =>
      cli([
        'status',
      ]).then(
        (result) => result.stdout,
        () => '',
      ),
    )
    .toMatch(/Clef running \(PID \d+\)/);
  expect(
    (
      await cli([
        'status',
      ])
    ).stdout,
  ).not.toBe(firstStatus);
  expect((await installed.nativeStatus()).stdout).toContain(installed.config);

  await cli([
    'stop',
  ]);
  expect(
    (
      await cli([
        'status',
      ])
    ).stdout,
  ).toContain('Clef stopped.');
  await expect
    .poll(async () =>
      fetch(new URL('/api/status', setupUrl)).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false);
  await installed.reinstall();
  expect((await cli()).stdout).not.toContain('#setup=');
  await page.context().clearCookies();
  await page.goto(new URL('/', setupUrl).href);
  await page.getByLabel('Username').fill('package-user');
  await page
    .getByLabel('Password', {
      exact: true,
    })
    .fill('a long package test password');
  await page
    .getByRole('button', {
      name: 'Sign in',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', {
      name: 'OpenAI',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Sign in with ChatGPT',
    }),
  ).toBeVisible();

  await copyFile(installed.archive, test.info().outputPath(artifact.filename));
});
