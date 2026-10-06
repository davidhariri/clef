import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const cli = resolve('node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');
const config = resolve('.dependency-cruiser.cjs');

async function inspectFixture(files: Record<string, string>) {
  const home = await mkdtemp(join(tmpdir(), 'clef-boundary-'));
  try {
    const fixture = {
      'tsconfig.json': '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}',
      'src/server/access/service.ts': 'export const access = 1;',
      'src/server/access/index.ts': 'export { access } from "./service.js";',
      'src/server/access/contract.ts': 'export type Client = { name: string };',
      'src/server/messages/index.ts': 'export const message = 1;',
      'src/tui/settings/settings.ts': 'export const settings = 1;',
      'src/tui/settings/index.ts': 'export { settings } from "./settings.js";',
      'src/tui/messages/index.ts': 'export const chat = 1;',
      'src/client/index.ts': 'export const client = 1;',
      ...files,
    };
    for (const [path, content] of Object.entries(fixture)) {
      await mkdir(dirname(join(home, path)), {
        recursive: true,
      });
      await writeFile(join(home, path), content);
    }
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'src',
        '--config',
        config,
      ],
      {
        cwd: home,
        encoding: 'utf8',
      },
    );
    if (result.error) throw result.error;
    return {
      status: result.status,
      output: result.stdout + result.stderr,
    };
  } finally {
    await rm(home, {
      recursive: true,
      force: true,
    });
  }
}

it.each([
  [
    'host processes in another feature',
    'src/server/agent/index.ts',
    'export { execFile } from "node:child_process";',
    'no-host-process-execution',
  ],
  [
    'host processes in platform',
    'src/server/platform/process.ts',
    'export { execFile } from "node:child_process";',
    'no-host-process-execution',
  ],
  [
    'host processes elsewhere in lifecycle',
    'src/server/lifecycle/index.ts',
    'export { spawn } from "child_process";',
    'no-host-process-execution',
  ],
  [
    'VM execution in the native supervisor',
    'src/server/lifecycle/supervisor.ts',
    'export { runInNewContext } from "node:vm";',
    'no-host-code-execution',
  ],
  [
    'VM execution in other features',
    'src/server/agent/index.ts',
    'export { runInNewContext } from "vm";',
    'no-host-code-execution',
  ],
  [
    'SQLite drivers in lifecycle',
    'src/server/lifecycle/repository.ts',
    'export { DatabaseSync } from "node:sqlite";',
    'sqlite-driver-has-one-owner',
  ],
  [
    'private terminal implementation',
    'src/tui/messages/index.ts',
    'export { settings } from "../settings/settings.js";',
    'tui-settings-private-implementation',
  ],
  [
    'feature-aware shared UI',
    'src/tui/components/button.ts',
    'export { settings } from "../settings/index.js";',
    'tui-components-have-no-app-dependencies',
  ],
  [
    'feature-aware terminal platform',
    'src/tui/platform/events.ts',
    'export { settings } from "../settings/index.js";',
    'tui-platform-has-no-features',
  ],
  [
    'private implementation',
    'src/server/messages/index.ts',
    'export { access } from "../access/service.js";',
    'access-private-implementation',
  ],
  [
    'private types',
    'src/server/messages/index.ts',
    'export type { Client } from "../access/model.js";',
    'access-private-implementation',
  ],
  [
    'client server imports',
    'src/tui/app.ts',
    'export { access } from "../server/access/index.js";',
    'clients-only-import-contracts',
  ],
  [
    'transport server imports',
    'src/client/index.ts',
    'export { access } from "../server/access/index.js";',
    'clients-only-import-contracts',
  ],
  [
    'unsafe contracts',
    'src/server/access/contract.ts',
    'export { access } from "./service.js";',
    'contracts-are-client-safe',
  ],
  [
    'Node in contracts',
    'src/server/access/contract.ts',
    'export { readFile } from "node:fs/promises";',
    'contracts-have-no-node-runtime',
  ],
  [
    'feature-aware platform',
    'src/server/platform/database.ts',
    'export { access } from "../access/index.js";',
    'platform-has-no-features',
  ],
  [
    'server client coupling',
    'src/server/access/index.ts',
    'export { client } from "../../client/index.js";',
    'server-has-no-clients',
  ],
  [
    'circular modules',
    'src/server/messages/index.ts',
    'export { access } from "../access/index.js";',
    'no-cycles',
  ],
])('rejects %s', async (name, path, source, rule) => {
  const files: Record<string, string> = {
    [path]: source,
  };
  if (name === 'private types')
    files['src/server/access/model.ts'] = 'export type Client = { name: string };';
  if (name === 'circular modules')
    files['src/server/access/service.ts'] =
      'export { message as access } from "../messages/index.js";';
  const result = await inspectFixture(files);
  expect(result.status).toBe(1);
  expect(result.output).toContain(rule);
});

it('allows native service commands only from the lifecycle supervisor', async () => {
  const result = await inspectFixture({
    'src/server/lifecycle/supervisor.ts':
      'import { execFile } from "node:child_process"; export const inspect = () => execFile("launchctl", ["print", "gui/501"]);',
  });
  expect(result.status).toBe(0);
});

it('allows public feature interfaces and client-safe contracts', async () => {
  const result = await inspectFixture({
    'src/server/messages/index.ts': 'export { access } from "../access/index.js";',
    'src/tui/app.ts': 'export type { Client } from "../server/access/contract.js";',
  });
  expect(result.status).toBe(0);
});

it('keeps the terminal as the only executable client', async () => {
  expect((await readdir('src')).sort()).toEqual([
    'client',
    'main.ts',
    'server',
    'tui',
  ]);
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  expect(manifest.bin).toEqual({
    clef: 'lib/main.js',
  });
  expect(manifest.files).toEqual([
    'INSTALLATION.md',
    'lib/',
  ]);
});

it('keeps server code in feature folders with public interfaces', async () => {
  const entries = await readdir('src/server', {
    withFileTypes: true,
  });
  const layers = new Set([
    'routes',
    'services',
    'repositories',
    'controllers',
    'utils',
    'shared',
    'common',
    'core',
  ]);
  for (const entry of entries) {
    if (entry.isFile())
      expect([
        'app.ts',
        'main.ts',
      ]).toContain(entry.name);
    else {
      expect(layers.has(entry.name), entry.name).toBe(false);
      if (entry.name !== 'platform')
        expect(await readdir(join('src/server', entry.name))).toContain('index.ts');
    }
  }
});

it('keeps terminal features behind public entry points', async () => {
  const entries = await readdir('src/tui', {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      ![
        'components',
        'platform',
      ].includes(entry.name)
    )
      expect(await readdir(join('src/tui', entry.name))).toContain('index.ts');
  }
});

it('does not contain suppression directives or code comments', async () => {
  const paths = (
    await readdir('src', {
      recursive: true,
    })
  ).filter((path) => /\.[cm]?[jt]sx?$/.test(path));
  const comments: string[] = [];
  for (const path of paths) {
    const content = await readFile(join('src', path), 'utf8');
    expect(content, path).not.toMatch(/biome-ignore|eslint-disable|@ts-ignore|@ts-nocheck/);
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    function inspect(node: ts.Node): void {
      const ranges = [
        ...(ts.getLeadingCommentRanges(content, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(content, node.end) ?? []),
      ];
      if (ranges.length > 0) comments.push(path);
      for (const child of node.getChildren(source)) inspect(child);
    }
    inspect(source);
  }
  expect([
    ...new Set(comments),
  ]).toEqual([]);
});
