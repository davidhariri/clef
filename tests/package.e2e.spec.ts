import { copyFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from '@lydell/node-pty';
import xterm from '@xterm/headless';
import { execute, expect, test } from './package.js';

function checkFiles(paths: string[]): void {
  expect(paths).toEqual(
    expect.arrayContaining([
      'package.json',
      'README.md',
      'INSTALLATION.md',
      'LICENSE',
      'lib/main.js',
      'lib/server/main.js',
      'lib/tui/app.js',
      'lib/client/api.js',
    ]),
  );
  expect(
    paths.filter(
      (path) => !/^(package\.json|README\.md|INSTALLATION\.md|LICENSE|lib\/.+\.js)$/.test(path),
    ),
  ).toEqual([]);
  expect(paths.filter((path) => /\.(test|e2e\.spec)\.js$/.test(path))).toEqual([]);
}

function terminal(bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const screen = new xterm.Terminal({
    cols: 90,
    rows: 30,
    allowProposedApi: true,
  });
  const process = spawn(bin, args, {
    cwd,
    env,
    cols: 90,
    rows: 30,
    name: 'xterm-256color',
  });
  let output = '';
  let exited = false;
  let code: number | undefined;
  process.onData((data) => {
    output += data;
    screen.write(data);
  });
  const done = new Promise<number>((resolve) =>
    process.onExit(({ exitCode }) => {
      exited = true;
      code = exitCode;
      resolve(exitCode);
    }),
  );
  return {
    write: (data: string) => process.write(data),
    done,
    exitCode: () => code,
    output: () => output,
    text: () =>
      Array.from(
        {
          length: screen.buffer.active.length,
        },
        (_, index) => screen.buffer.active.getLine(index)?.translateToString(true) ?? '',
      ).join('\n'),
    close: async () => {
      if (!exited) process.kill();
      await done;
      screen.dispose();
    },
  };
}

test('npm run chat starts a native service from the built launcher', async ({ installed }) => {
  const tui = terminal(
    'npm',
    [
      'run',
      'chat',
    ],
    process.cwd(),
    installed.environment,
  );
  try {
    await expect
      .poll(tui.text, {
        timeout: 25000,
      })
      .toContain('Connect a model provider');
    tui.write('\u0004');
    await expect.poll(tui.exitCode).toBe(0);
    const service = JSON.parse(await readFile(join(installed.home, 'service.json'), 'utf8'));
    expect(service.entry).toBe(join(process.cwd(), 'lib/main.js'));
    expect(
      (
        await installed.cli([
          'status',
        ])
      ).stdout,
    ).toContain('Clef running');
  } finally {
    await tui.close();
  }
});

test('installs without scripts, opens terminal setup, and preserves access and credentials across updates', async ({
  installed,
}) => {
  test.setTimeout(120_000);
  const { cli, artifact, manifest, home } = installed;
  expect(artifact.name).toBe('@davidhariri/clef');
  checkFiles(artifact.files.map((file) => file.path));
  expect(manifest.bin).toEqual({
    clef: 'lib/main.js',
  });
  expect(manifest.license).toBe('MIT');
  for (const script of [
    'preinstall',
    'install',
    'postinstall',
  ])
    expect(manifest.scripts[script]).toBeUndefined();
  await expect(cli([])).rejects.toThrow('Chat needs an interactive terminal');

  const tui = terminal(installed.bin, [], installed.root, installed.environment);
  try {
    await expect
      .poll(tui.text, {
        timeout: 20000,
      })
      .toContain('Connect a model provider');
    tui.write('\u0004');
    await expect
      .poll(tui.exitCode, {
        message: 'First-run terminal exits',
      })
      .toBe(0);
  } finally {
    await tui.close();
  }
  const started = await cli();
  const url = `http://127.0.0.1:${installed.port}`;
  expect(started.stdout).toContain(`Clef: ${url}`);
  const token = await readFile(join(home, 'secrets', 'local-token'), 'utf8');
  const headers = {
    authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  expect((await fetch(`${url}/api/status`)).status).toBe(401);
  expect((await fetch(url)).status).toBe(404);
  const connected = await fetch(`${url}/api/models/key`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      provider: 'openai',
      key: 'package-test-api-key',
    }),
  });
  expect(connected.ok).toBe(true);
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

  for (const name of [
    'service.json',
    'service.log',
    'runtime.sock',
    'owner.sqlite',
    'secrets/local-token',
    'secrets/encryption.key',
  ])
    expect((await stat(join(home, name))).mode & 0o777).toBe(0o600);
  const log = await readFile(join(home, 'service.log'), 'utf8');
  expect(log).not.toContain(token);
  expect(log).not.toContain('package-test-api-key');
  expect(tui.output()).not.toContain(token);
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
  expect(processCommand).toContain(join(installed.packagePath, 'lib/main.js'));
  expect(configuration).toContain(
    process.platform === 'darwin' ? '<key>RunAtLoad</key><true/>' : 'WantedBy=default.target',
  );
  if (process.platform === 'linux')
    expect((await installed.autoStartStatus()).stdout.trim()).toBe('enabled');
  await installed.reload();
  await expect
    .poll(() =>
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
    .poll(() =>
      fetch(`${url}/api/status`).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false);
  await installed.reinstall();
  await cli();
  expect(await readFile(join(home, 'secrets', 'local-token'), 'utf8')).toBe(token);
  expect(
    await (
      await fetch(`${url}/api/status`, {
        headers,
      })
    ).json(),
  ).toMatchObject({
    phase: 'ready',
  });
  const chat = terminal(installed.bin, [], installed.root, installed.environment);
  try {
    await expect.poll(chat.text).toContain('/ Commands');
    await expect.poll(chat.text).toContain('Ready');
    chat.write('/settings\r');
    await expect.poll(chat.text).toContain('Client access');
    chat.write('\u001b');
    await expect.poll(chat.text).not.toContain('Client access');
    chat.write('\u0004');
    await expect.poll(chat.exitCode).toBe(0);
  } finally {
    await chat.close();
  }
  await copyFile(installed.archive, test.info().outputPath(artifact.filename));
});

test('connects a separate terminal with a saved revocable token and never prints that token', async ({
  installed,
}) => {
  await installed.cli();
  const url = `http://127.0.0.1:${installed.port}`;
  const token = await readFile(join(installed.home, 'secrets', 'local-token'), 'utf8');
  const headers = {
    authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const issued = await (
    await fetch(`${url}/api/access/clients`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Test terminal',
      }),
    })
  ).json();
  const environment = {
    ...installed.environment,
    CLEF_HOME: join(installed.root, 'unused-home'),
    XDG_CONFIG_HOME: join(installed.root, 'client-config'),
  };
  const tui = terminal(
    installed.bin,
    [
      '--server',
      url,
    ],
    installed.root,
    environment,
  );
  try {
    await expect.poll(tui.text).toContain('Client token');
    tui.write(`${issued.token}\r`);
    await expect.poll(tui.text).toContain('Connect a model provider');
    tui.write('\u0004');
    await expect.poll(tui.exitCode).toBe(0);
    expect(tui.output()).not.toContain(issued.token);
  } finally {
    await tui.close();
  }
  const reopened = terminal(
    installed.bin,
    [
      '--server',
      url,
    ],
    installed.root,
    environment,
  );
  try {
    await expect.poll(reopened.text).toContain('Connect a model provider');
    expect(reopened.output()).not.toContain('Client token');
    reopened.write('\u0004');
    await expect.poll(reopened.exitCode).toBe(0);
  } finally {
    await reopened.close();
  }
  expect(
    (
      await fetch(`${url}/api/access/clients/${issued.id}`, {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await fetch(`${url}/api/status`, {
        headers: {
          authorization: `Bearer ${issued.token}`,
        },
      })
    ).status,
  ).toBe(401);
  await expect(stat(environment.CLEF_HOME)).rejects.toThrow();
});

test('attaches chat to a foreground server without registering a native service', async ({
  installed,
}) => {
  const server = terminal(
    installed.bin,
    [
      'serve',
    ],
    installed.root,
    installed.environment,
  );
  let chat: ReturnType<typeof terminal> | undefined;
  try {
    await expect.poll(server.text).toContain('Clef:');
    chat = terminal(installed.bin, [], installed.root, installed.environment);
    await expect.poll(chat.text).toContain('Connect a model provider');
    chat.write('\u0004');
    await expect.poll(chat.exitCode).toBe(0);
    expect(server.exitCode()).toBeUndefined();
    await expect(stat(installed.config)).rejects.toThrow();
  } finally {
    await chat?.close();
    await server.close();
  }
});
