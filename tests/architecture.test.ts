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
      'src/server/accounts/service.ts': 'export const account = 1;',
      'src/server/accounts/index.ts': 'export { account } from "./service.js";',
      'src/server/accounts/contract.ts': 'export type Account = { name: string };',
      'src/server/messages/index.ts': 'export const message = 1;',
      'src/web/models/settings.ts': 'export const settings = 1;',
      'src/web/models/index.ts': 'export { settings } from "./settings.js";',
      'src/web/messages/index.ts': 'export const chat = 1;',
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
    'private web implementation',
    'src/web/messages/index.ts',
    'export { settings } from "../models/settings.js";',
    'web-models-private-implementation',
  ],
  [
    'feature-aware shared UI',
    'src/web/components/button.ts',
    'export { settings } from "../models/index.js";',
    'web-components-have-no-app-dependencies',
  ],
  [
    'feature-aware web platform',
    'src/web/platform/events.ts',
    'export { settings } from "../models/index.js";',
    'web-platform-has-no-features',
  ],
  [
    'private implementation',
    'src/server/messages/index.ts',
    'export { account } from "../accounts/service.js";',
    'accounts-private-implementation',
  ],
  [
    'private types',
    'src/server/messages/index.ts',
    'export type { Account } from "../accounts/model.js";',
    'accounts-private-implementation',
  ],
  [
    'client server imports',
    'src/web/app.ts',
    'export { account } from "../server/accounts/index.js";',
    'clients-only-import-contracts',
  ],
  [
    'unsafe contracts',
    'src/server/accounts/contract.ts',
    'export { account } from "./service.js";',
    'contracts-are-browser-safe',
  ],
  [
    'Node in contracts',
    'src/server/accounts/contract.ts',
    'export { readFile } from "node:fs/promises";',
    'contracts-have-no-node-runtime',
  ],
  [
    'feature-aware platform',
    'src/server/platform/database.ts',
    'export { account } from "../accounts/index.js";',
    'platform-has-no-features',
  ],
  [
    'circular modules',
    'src/server/messages/index.ts',
    'export { account } from "../accounts/index.js";',
    'no-cycles',
  ],
])('rejects %s', async (name, path, source, rule) => {
  const files: Record<string, string> = {
    [path]: source,
  };
  if (name === 'private types')
    files['src/server/accounts/model.ts'] = 'export type Account = { name: string };';
  if (name === 'circular modules')
    files['src/server/accounts/service.ts'] =
      'export { message as account } from "../messages/index.js";';
  const result = await inspectFixture(files);
  expect(result.status).toBe(1);
  expect(result.output).toContain(rule);
});

it('allows public feature interfaces and browser-safe contracts', async () => {
  const result = await inspectFixture({
    'src/server/messages/index.ts': 'export { account } from "../accounts/index.js";',
    'src/web/app.ts': 'export type { Account } from "../server/accounts/contract.js";',
  });
  expect(result.status).toBe(0);
});

it('keeps server code inside feature folders and exposes a public interface for each feature', async () => {
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

it('keeps web features behind public entry points', async () => {
  const entries = await readdir('src/web', {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (entry.isFile() && !entry.name.endsWith('.e2e.spec.ts'))
      expect([
        'main.tsx',
        'index.html',
        'globals.css',
        'theme.css',
      ]).toContain(entry.name);
    if (
      entry.isDirectory() &&
      ![
        'components',
        'platform',
      ].includes(entry.name)
    ) {
      const files = await readdir(join('src/web', entry.name));
      expect(
        files.some((file) => file === 'index.ts' || file === 'index.tsx'),
        entry.name,
      ).toBe(true);
    }
  }
});

it('does not contain suppression directives or Clef-owned code comments', async () => {
  const paths = (
    await readdir('src', {
      recursive: true,
    })
  ).filter((path) => /\.[cm]?[jt]sx?$/.test(path));
  const comments: string[] = [];
  for (const path of paths) {
    const content = await readFile(join('src', path), 'utf8');
    expect(content, path).not.toMatch(/biome-ignore|eslint-disable|@ts-ignore|@ts-nocheck/);
    if (path.startsWith('web/components/upstream/')) continue;

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
