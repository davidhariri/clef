import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('expands objects and preserves the space between preparation and return', () => {
  const source = [
    'export function account(username: string) {',
    "  const salt = 'example';",
    '',
    "  return { username, salt, hash: 'example' };",
    '}',
    '',
  ].join('\n');

  const result = spawnSync(
    resolve('node_modules/.bin/biome'),
    [
      'format',
      '--stdin-file-path=account.ts',
    ],
    {
      input: source,
      encoding: 'utf8',
    },
  );

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe(
    [
      'export function account(username: string) {',
      "  const salt = 'example';",
      '',
      '  return {',
      '    username,',
      '    salt,',
      "    hash: 'example',",
      '  };',
      '}',
      '',
    ].join('\n'),
  );
});

it.each([
  [
    'src/tui/messages/example.ts',
    1,
  ],
  [
    'src/server/access/example.ts',
    1,
  ],
  [
    'src/tui/components/example.ts',
    1,
  ],
])('applies the complexity policy to %s', async (path, status) => {
  const source = `export function nested(value: boolean) { ${'if (value) { '.repeat(6)} return 1; ${'} '.repeat(6)} return 0; }`;
  const home = await mkdtemp(join(tmpdir(), 'clef-complexity-'));

  try {
    await copyFile('biome.json', join(home, 'biome.json'));
    await mkdir(dirname(join(home, path)), {
      recursive: true,
    });
    await writeFile(join(home, path), source);

    const result = spawnSync(
      resolve('node_modules/.bin/biome'),
      [
        'lint',
        '--vcs-enabled=false',
        path,
      ],
      {
        cwd: home,
        encoding: 'utf8',
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(status);
    if (status !== 0) expect(result.stderr).toContain('max: 15');
  } finally {
    await rm(home, {
      recursive: true,
      force: true,
    });
  }
});
