import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { Runtime } from './repository.js';
import { readOptional, writePrivate } from './storage.js';

const execute = promisify(execFile);
type NativeCommand =
  | [
      'launchctl',
      (
        | [
            'print' | 'bootout',
            string,
          ]
        | [
            'bootstrap',
            string,
            string,
          ]
      ),
    ]
  | [
      'systemctl',
      (
        | [
            '--user',
            'show-environment' | 'daemon-reload',
          ]
        | [
            '--user',
            'show',
            string,
            '--property=LoadState,ActiveState,MainPID,FragmentPath',
          ]
        | [
            '--user',
            'enable' | 'disable',
            '--now',
            string,
          ]
      ),
    ];

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function systemd(value: string, expandEnvironment = false) {
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
  return `"${expandEnvironment ? escaped.replaceAll('$', () => '$$') : escaped}"`;
}

async function command(...[binary, args]: NativeCommand) {
  try {
    return (
      await execute(binary, args, {
        timeout: 10_000,
        shell: false,
      })
    ).stdout;
  } catch (error) {
    throw new Error(
      `${binary} ${args[0]} failed. A native user-session service manager is required. ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}

async function waitExited(pid: number) {
  if (!pid) return;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return;
      throw error;
    }
    await delay(100);
  }
  throw new Error('Clef did not stop. The service configuration was retained.');
}

async function inspectLaunchAgent(target: string) {
  try {
    const stdout = await command('launchctl', [
      'print',
      target,
    ]);
    return {
      loaded: true,
      pid: Number(/\bpid = (\d+)/.exec(stdout)?.[1] ?? 0),
      path: /\bpath = (.+)/.exec(stdout)?.[1],
    };
  } catch (error) {
    const cause = error instanceof Error ? error.cause : error;
    if (cause instanceof Error && 'code' in cause && cause.code === 113)
      return {
        loaded: false,
        pid: 0,
        path: undefined,
      };
    throw error;
  }
}

export function supervisor(home: string) {
  const mac = process.platform === 'darwin';
  if (!mac && process.platform !== 'linux') throw new Error('Clef supports macOS and Linux only.');
  const name = `dev.clef.${createHash('sha256').update(home).digest('hex').slice(0, 24)}`;
  const domain = `gui/${process.getuid?.()}`;
  const target = `${domain}/${name}`;
  const unit = `${name}.service`;
  const config = mac
    ? join(homedir(), 'Library', 'LaunchAgents', `${name}.plist`)
    : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'systemd', 'user', unit);
  const log = join(home, 'service.log');

  function render(runtime: Runtime) {
    if (mac)
      return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${name}</string>
<key>ProgramArguments</key><array><string>${xml(runtime.node)}</string><string>${xml(runtime.entry)}</string><string>serve</string></array>
<key>EnvironmentVariables</key><dict><key>CLEF_HOME</key><string>${xml(home)}</string><key>CLEF_PORT</key><string>${runtime.port}</string><key>CLEF_MANAGED</key><string>1</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>WorkingDirectory</key><string>${xml(home)}</string>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
<key>Umask</key><integer>63</integer>
</dict></plist>
`;
    return `[Unit]
Description=Clef personal server

[Service]
Type=simple
ExecStart=${systemd(runtime.node, true)} ${systemd(runtime.entry, true)} serve
Environment=${systemd(`CLEF_HOME=${home}`)} ${systemd(`CLEF_PORT=${runtime.port}`)} "CLEF_MANAGED=1"
WorkingDirectory=${home.replaceAll('%', '%%')}
Restart=on-failure
RestartSec=2
UMask=0077
StandardOutput=append:${log.replaceAll('%', '%%')}
StandardError=append:${log.replaceAll('%', '%%')}

[Install]
WantedBy=default.target
`;
  }

  async function available() {
    if (mac)
      await command('launchctl', [
        'print',
        domain,
      ]);
    else
      await command('systemctl', [
        '--user',
        'show-environment',
      ]);
  }

  async function inspect() {
    if (mac) return inspectLaunchAgent(target);
    const text = await command('systemctl', [
      '--user',
      'show',
      unit,
      '--property=LoadState,ActiveState,MainPID,FragmentPath',
    ]);
    const values = Object.fromEntries(
      text
        .trim()
        .split('\n')
        .map((line) => [
          line.slice(0, line.indexOf('=')),
          line.slice(line.indexOf('=') + 1),
        ]),
    );
    return {
      loaded: values.LoadState !== 'not-found',
      pid: Number(values.MainPID ?? 0),
      path: values.FragmentPath || undefined,
    };
  }

  async function verify(runtime: Runtime | undefined) {
    const existing = await readOptional(config);
    if (existing !== undefined && (!runtime || existing !== render(runtime)))
      throw new Error(`Service configuration conflict: ${config}`);
    const state = await inspect();
    if (state.loaded && (!runtime || state.path !== config))
      throw new Error(`Another service owns ${name}.`);
    return state;
  }

  return {
    config,
    log,
    available,
    inspect,
    verify,
    async start(runtime: Runtime) {
      await mkdir(dirname(config), {
        recursive: true,
      });
      await writePrivate(log, '');
      await writePrivate(config, render(runtime));
      if (mac) {
        await command('launchctl', [
          'bootstrap',
          domain,
          config,
        ]);
      } else {
        await command('systemctl', [
          '--user',
          'daemon-reload',
        ]);
        await command('systemctl', [
          '--user',
          'enable',
          '--now',
          unit,
        ]);
      }
    },
    async stop() {
      const state = await inspect();
      if (mac) {
        if (state.loaded)
          await command('launchctl', [
            'bootout',
            target,
          ]);
      } else if (state.loaded) {
        await command('systemctl', [
          '--user',
          'disable',
          '--now',
          unit,
        ]);
      }
      await waitExited(state.pid);
      await rm(config, {
        force: true,
      });
      if (!mac)
        await command('systemctl', [
          '--user',
          'daemon-reload',
        ]);
    },
  };
}
