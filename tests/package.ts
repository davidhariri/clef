import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { test as base, expect } from '@playwright/test';
import { z } from 'zod';
import { availablePort } from './network.js';

export const execute = promisify(execFile);
const artifactSchema = z.object({
  name: z.string(),
  filename: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
    }),
  ),
});

async function stopLaunchAgent(target: string) {
  let output: string;
  try {
    output = (
      await execute('launchctl', [
        'print',
        target,
      ])
    ).stdout;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 113) return;
    throw error;
  }
  const pid = Number(/\bpid = (\d+)/.exec(output)?.[1] ?? 0);
  await execute('launchctl', [
    'bootout',
    target,
  ]);
  if (pid)
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
          throw error;
        }
      })
      .toBe(false);
  await expect(
    execute('launchctl', [
      'print',
      target,
    ]),
  ).rejects.toHaveProperty('code', 113);
}

async function installation(root: string, packaged: Awaited<ReturnType<typeof installPackage>>) {
  const prefix = join(root, 'install');
  await symlink(packaged.prefix, prefix, 'dir');
  const bin = join(prefix, 'bin/clef');
  const home = join(root, 'data');
  const port = await availablePort();
  const environment = {
    ...process.env,
    CLEF_HOME: home,
    CLEF_PORT: String(port),
  };
  const name = `dev.clef.${createHash('sha256').update(home).digest('hex').slice(0, 24)}`;
  const mac = process.platform === 'darwin';
  const domain = `gui/${process.getuid?.()}`;
  const unit = `${name}.service`;
  const config = mac
    ? join(homedir(), 'Library', 'LaunchAgents', `${name}.plist`)
    : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'systemd', 'user', unit);
  await mkdir('tmp/factory-installation', {
    recursive: true,
  });
  await appendFile(
    'tmp/factory-installation/native-resources.jsonl',
    `${JSON.stringify({
      root,
      home,
      config,
      name,
      port,
      prefix,
      packagePath: packaged.packagePath,
    })}\n`,
  );
  return {
    ...packaged,
    root,
    prefix,
    home,
    port,
    environment,
    config,
    bin,
    cli: (
      args: string[] = [
        'start',
      ],
      env: NodeJS.ProcessEnv = {},
    ) =>
      execute(bin, args, {
        cwd: root,
        env: {
          ...environment,
          ...env,
        },
        timeout: 20_000,
      }),
    async reload() {
      if (mac) {
        await stopLaunchAgent(`${domain}/${name}`);
        await execute('launchctl', [
          'bootstrap',
          domain,
          config,
        ]);
      } else {
        await execute('systemctl', [
          '--user',
          'daemon-reload',
        ]);
        await execute('systemctl', [
          '--user',
          'restart',
          unit,
        ]);
      }
    },
    async autoStartStatus() {
      return execute('systemctl', [
        '--user',
        'is-enabled',
        unit,
      ]);
    },
    async nativeStatus() {
      return execute(
        mac ? 'launchctl' : 'systemctl',
        mac
          ? [
              'print',
              `${domain}/${name}`,
            ]
          : [
              '--user',
              'show',
              unit,
            ],
      );
    },
    async dispose() {
      if (mac) {
        await stopLaunchAgent(`${domain}/${name}`);
      } else {
        const state = await execute('systemctl', [
          '--user',
          'show',
          unit,
          '--property=ActiveState',
          '--value',
        ]);
        if (
          [
            'active',
            'activating',
            'deactivating',
          ].includes(state.stdout.trim())
        )
          await execute('systemctl', [
            '--user',
            'stop',
            unit,
          ]);
        await rm(join(dirname(config), 'default.target.wants', unit), {
          force: true,
        });
      }
      await rm(config, {
        force: true,
      });
      if (!mac)
        await execute('systemctl', [
          '--user',
          'daemon-reload',
        ]);
      await rm(root, {
        recursive: true,
        force: true,
      });
    },
  };
}

async function installPackage(root: string) {
  const prefix = join(root, 'install');
  const packed = await execute('npm', [
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    root,
  ]);
  const artifact = artifactSchema.parse(JSON.parse(packed.stdout)[0]);
  const archive = join(root, artifact.filename);
  const reinstall = () =>
    execute(
      'npm',
      [
        'install',
        '--global',
        '--prefix',
        prefix,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        archive,
      ],
      {
        cwd: root,
        timeout: 90_000,
      },
    );
  await reinstall();
  const packagePath = join(prefix, 'lib/node_modules/@davidhariri/clef');
  const manifest = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8'));
  return {
    prefix,
    archive,
    artifact,
    manifest,
    packagePath,
    reinstall,
  };
}

export const test = base.extend<
  {
    installed: Awaited<ReturnType<typeof installation>>;
  },
  {
    packaged: Awaited<ReturnType<typeof installPackage>>;
  }
>({
  packaged: [
    async ({ playwright: _playwright }, use) => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'clef npm &$%-')));
      try {
        await use(await installPackage(root));
      } finally {
        await rm(root, {
          recursive: true,
          force: true,
        });
      }
    },
    {
      scope: 'worker',
      timeout: 120_000,
    },
  ],
  installed: [
    async ({ packaged }, use) => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'clef &$%-')));
      let installed: Awaited<ReturnType<typeof installation>> | undefined;
      try {
        installed = await installation(root, packaged);
        await use(installed);
      } finally {
        if (installed) await installed.dispose();
        else
          await rm(root, {
            recursive: true,
            force: true,
          });
      }
    },
    {
      timeout: 120_000,
    },
  ],
});
export { expect } from '@playwright/test';
