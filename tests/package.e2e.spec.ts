import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { z } from 'zod';

const execute = promisify(execFile);
const artifactSchema = z.object({
  name: z.string(),
  filename: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
    }),
  ),
});

async function availablePort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as AddressInfo).port;
  const closed = once(listener, 'close');
  listener.close();
  await closed;

  return port;
}

async function stop(server: ChildProcess): Promise<void> {
  if (!server.pid || server.exitCode !== null || server.signalCode !== null) return;

  const closed = once(server, 'exit');
  const timeout = setTimeout(() => server.kill('SIGKILL'), 5000);
  timeout.unref();
  server.kill('SIGTERM');

  try {
    await closed;
  } finally {
    clearTimeout(timeout);
  }
}

function checkFiles(paths: string[]): void {
  expect(paths).toEqual(
    expect.arrayContaining([
      'package.json',
      'README.md',
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
        !/^(package\.json|README\.md|LICENSE|lib\/server\/.+\.js|dist\/(index\.html|\.vite\/license\.md|assets\/.+)|src\/web\/components\/upstream\/(LICENSE-(AI-ELEMENTS|SHADCN)|UPSTREAM\.md))$/.test(
          path,
        ),
    ),
  ).toEqual([]);
  expect(paths.filter((path) => /\.(test|e2e\.spec)\.js$/.test(path))).toEqual([]);
}

test('installs globally without scripts and serves setup outside the source checkout', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const home = await mkdtemp(join(tmpdir(), 'clef-package-'));
  const prefix = join(home, 'install');
  let server: ChildProcess | undefined;

  try {
    const packed = await execute('npm', [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      home,
    ]);
    const artifact = artifactSchema.parse(JSON.parse(packed.stdout)[0]);
    expect(artifact.name).toBe('@davidhariri/clef');
    checkFiles(artifact.files.map((file) => file.path));

    await execute(
      'npm',
      [
        'install',
        '--global',
        '--prefix',
        prefix,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        join(home, artifact.filename),
      ],
      {
        cwd: home,
        timeout: 90_000,
      },
    );
    const installation = join(prefix, 'lib/node_modules/@davidhariri/clef');
    const manifest = JSON.parse(await readFile(join(installation, 'package.json'), 'utf8'));
    expect(manifest.license).toBe('MIT');
    expect(manifest.bin).toEqual({
      clef: 'lib/server/main.js',
    });
    expect(manifest.scripts.preinstall).toBeUndefined();
    expect(manifest.scripts.install).toBeUndefined();
    expect(manifest.scripts.postinstall).toBeUndefined();

    let output = '';
    server = spawn(join(prefix, 'bin/clef'), [], {
      cwd: home,
      env: {
        ...process.env,
        CLEF_HOME: join(home, 'data'),
        CLEF_PORT: String(await availablePort()),
      },
    });
    server.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });
    let failure = '';
    server.stderr?.on('data', (data: Buffer) => {
      failure += data.toString();
    });
    server.on('error', (error) => {
      failure += error.message;
    });
    await expect
      .poll(
        () => ({
          ready: output.includes('Set up Clef: '),
          exited: server?.exitCode,
        }),
        {
          message: 'The installed server must start successfully',
        },
      )
      .toEqual({
        ready: true,
        exited: null,
      });
    const setupUrl = /Set up Clef: (http:\/\/[^\s]+)/.exec(output)?.[1];
    if (!setupUrl) throw new Error(`No setup link from the installed server: ${failure}`);

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

    await copyFile(join(home, artifact.filename), test.info().outputPath(artifact.filename));
  } finally {
    if (server) await stop(server);
    await rm(home, {
      recursive: true,
      force: true,
    });
  }
});
