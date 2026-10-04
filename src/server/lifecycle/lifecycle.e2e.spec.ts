import { once } from 'node:events';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { availablePort, expect, test } from '../../../tests/package.js';

test('rejects an occupied port before registering a service or opening application data', async ({
  installed,
}) => {
  const other = createServer((_request, response) => response.end('another installation'));
  other.listen(installed.port, '127.0.0.1');
  await once(other, 'listening');
  try {
    await expect(installed.cli()).rejects.toThrow('is already in use');
    expect(await (await fetch(`http://127.0.0.1:${installed.port}`)).text()).toBe(
      'another installation',
    );
    await expect(access(installed.config)).rejects.toThrow();
    await expect(access(join(installed.home, 'state', 'clef.sqlite'))).rejects.toThrow();
  } finally {
    const closed = once(other, 'close');
    other.close();
    await closed;
  }
});

test('rejects data paths that cannot contain a private readiness socket', async ({ installed }) => {
  const home = join(installed.root, 'x'.repeat(110));
  await expect(
    installed.cli([], {
      CLEF_HOME: home,
    }),
  ).rejects.toThrow('Unix socket path');
  await expect(access(join(home, 'state', 'clef.sqlite'))).rejects.toThrow();
});

test('reports an unavailable user-session supervisor without initializing the app', async ({
  installed,
}) => {
  const commands = join(installed.root, 'commands');
  await mkdir(commands);
  const binary = process.platform === 'darwin' ? 'launchctl' : 'systemctl';
  await writeFile(
    join(commands, binary),
    `#!${process.execPath}\nprocess.stderr.write('No user session available'); process.exit(1);\n`,
    {
      mode: 0o700,
    },
  );
  await expect(
    installed.cli([], {
      PATH: `${commands}:${dirname(process.execPath)}:/usr/bin:/bin`,
    }),
  ).rejects.toThrow('native user-session service manager is required');
  await expect(access(installed.config)).rejects.toThrow();
  await expect(access(join(installed.home, 'state', 'clef.sqlite'))).rejects.toThrow();
});

test('refuses conflicting service configuration without replacing or loading it', async ({
  installed,
}) => {
  await mkdir(dirname(installed.config), {
    recursive: true,
  });
  await writeFile(installed.config, 'another service owns this file', {
    mode: 0o600,
  });
  await expect(installed.cli()).rejects.toThrow('Service configuration conflict');
  expect(await readFile(installed.config, 'utf8')).toBe('another service owns this file');
  await expect(access(join(installed.home, 'state', 'clef.sqlite'))).rejects.toThrow();
});

test('prevents a second data owner even on a different port', async ({ installed }) => {
  await installed.cli();
  const original = (
    await installed.cli([
      'status',
    ])
  ).stdout;
  await expect(
    installed.cli(
      [
        'serve',
      ],
      {
        CLEF_PORT: String(await availablePort()),
      },
    ),
  ).rejects.toThrow('Another Clef process owns this installation');
  expect(
    (
      await installed.cli([
        'status',
      ])
    ).stdout,
  ).toBe(original);
});

test('recovers ownership and readiness after the managed process crashes', async ({
  installed,
}) => {
  test.setTimeout(60_000);
  await installed.cli();
  const status = (
    await installed.cli([
      'status',
    ])
  ).stdout;
  const pid = Number(/PID (\d+)/.exec(status)?.[1]);
  expect(pid).toBeGreaterThan(0);
  process.kill(pid, 'SIGKILL');
  await expect
    .poll(
      async () =>
        installed
          .cli([
            'status',
          ])
          .then(
            (result) => result.stdout,
            () => '',
          ),
      {
        timeout: 25_000,
      },
    )
    .toMatch(/Clef running \(PID \d+\)/);
  expect(
    (
      await installed.cli([
        'status',
      ])
    ).stdout,
  ).not.toBe(status);
  expect((await installed.cli()).stdout).toContain('Set up Clef:');
});

test('removes its auto-start configuration when supervisor registration fails', async ({
  installed,
}) => {
  const commands = join(installed.root, 'commands');
  await mkdir(commands);
  const mac = process.platform === 'darwin';
  const binary = mac ? 'launchctl' : 'systemctl';
  const native = mac ? '/bin/launchctl' : '/usr/bin/systemctl';
  await writeFile(
    join(commands, binary),
    `#!${process.execPath}\nconst {spawnSync} = require('node:child_process');\nconst args = process.argv.slice(2);\nif (args.includes(${JSON.stringify(mac ? 'bootstrap' : 'enable')})) { process.stderr.write('registration denied'); process.exit(5); }\nconst result = spawnSync(${JSON.stringify(native)}, args, {stdio: 'inherit'}); process.exit(result.status ?? 1);\n`,
    {
      mode: 0o700,
    },
  );
  await expect(
    installed.cli([], {
      PATH: `${commands}:${dirname(process.execPath)}:/usr/bin:/bin`,
    }),
  ).rejects.toThrow('registration denied');
  await expect(access(installed.config)).rejects.toThrow();
  expect(
    (
      await installed.cli([
        'status',
      ])
    ).stdout,
  ).toContain('Clef stopped.');
});

test('reports real startup failure, unregisters the failed service, and preserves existing data', async ({
  installed,
}) => {
  await mkdir(join(installed.home, 'state'), {
    recursive: true,
  });
  const database = join(installed.home, 'state', 'clef.sqlite');
  await writeFile(database, 'not a database');
  await expect(installed.cli()).rejects.toThrow('Clef did not become ready');
  expect(await readFile(database, 'utf8')).toBe('not a database');
  expect(
    (
      await installed.cli([
        'status',
      ])
    ).stdout,
  ).toContain('Clef stopped.');
  await expect(access(installed.config)).rejects.toThrow();
});
