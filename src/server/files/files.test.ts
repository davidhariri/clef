import { existsSync, truncateSync } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openPermissions } from '../permissions/index.js';
import { openFiles } from './index.js';

const cleanups: Array<() => Promise<void>> = [];

async function setup() {
  const installation = await testInstallation();
  await installation.settings.initialize(async () => undefined);
  const permissions = await openPermissions(installation.database, installation.settings);
  const files = openFiles(installation.home, installation.workspacePath, permissions);
  cleanups.push(async () => {
    permissions.close();
    await installation.dispose();
  });
  const invocation = {
    conversationId: 'chat',
    callId: 'call',
    signal: new AbortController().signal,
  };
  return {
    ...installation,
    permissions,
    files,
    invocation,
  };
}

async function externalDirectory() {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'clef-external-')));
  cleanups.push(() =>
    rm(path, {
      recursive: true,
      force: true,
    }),
  );
  return path;
}

async function decide(
  permissions: Awaited<ReturnType<typeof setup>>['permissions'],
  choice: 'once' | 'always' | 'deny' | 'never',
) {
  await vi.waitFor(() => expect(permissions.pending('chat')).toHaveLength(1));
  const pending = permissions.pending('chat')[0];
  if (!pending) throw new Error('Expected approval');
  await permissions.decide(pending.id, choice, 'chat');
  return pending;
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('creates, reads and lists workspace files through one checked interface', async () => {
  const { files, invocation, workspacePath, permissions } = await setup();
  await files.execute(
    {
      operation: 'write',
      path: 'hello.txt',
      content: 'Hello journal',
    },
    invocation,
  );
  expect(
    await files.execute(
      {
        operation: 'read',
        path: 'hello.txt',
      },
      invocation,
    ),
  ).toMatchObject({
    text: 'Hello journal',
    more: false,
  });
  expect(
    await files.execute(
      {
        operation: 'list',
        path: '.',
      },
      invocation,
    ),
  ).toMatchObject({
    entries: [
      {
        name: 'hello.txt',
        kind: 'file',
      },
    ],
    more: false,
  });
  expect(await readFile(join(workspacePath, 'hello.txt'), 'utf8')).toBe('Hello journal');
  expect((await files.access()).workspace).toBe(await realpath(workspacePath));
  expect(permissions.pending('chat')).toEqual([]);
});

it('binds one-time access to one action and saves only an approved directory grant', async () => {
  const { files, permissions, invocation, settings, database } = await setup();
  const directory = await externalDirectory();
  const path = join(directory, 'journal.md');
  await writeFile(path, 'Private journal');
  const command = {
    operation: 'read' as const,
    path,
  };
  const first = files.execute(command, invocation);
  expect(await decide(permissions, 'once')).toMatchObject({
    kind: 'file',
    path,
    directory,
    operation: 'read',
  });
  expect(await first).toMatchObject({
    text: 'Private journal',
  });
  expect((await files.access()).policy.directories).toHaveLength(1);

  const second = files.execute(command, invocation);
  await decide(permissions, 'always');
  await second;
  expect((await files.access()).policy.directories).toContainEqual({
    path: directory,
    access: 'read',
  });
  const reopened = await openPermissions(database, settings);
  expect((await reopened.fileAccess()).policy.directories).toContainEqual({
    path: directory,
    access: 'read',
  });
  reopened.close();
  expect(await files.execute(command, invocation)).toMatchObject({
    text: 'Private journal',
  });

  const denied = files.execute(
    {
      operation: 'write',
      path,
      content: 'Changed',
    },
    invocation,
  );
  const rejected = expect(denied).rejects.toThrow('denied');
  await decide(permissions, 'deny');
  await rejected;
  expect(await readFile(path, 'utf8')).toBe('Private journal');
});

it('requires a fresh exact approval for every deletion, even with global access', async () => {
  const { files, permissions, invocation, workspacePath } = await setup();
  const view = await permissions.fileAccess();
  await permissions.saveFileAccess(
    {
      ...view.policy,
      global: true,
    },
    view.revision,
    true,
  );
  for (const content of [
    'First version',
    'Second version',
  ]) {
    await files.execute(
      {
        operation: 'write',
        path: 'delete.txt',
        content,
      },
      invocation,
    );
    const pending = files.execute(
      {
        operation: 'delete',
        path: 'delete.txt',
      },
      invocation,
    );
    await vi.waitFor(() => expect(permissions.pending('chat')).toHaveLength(1));
    const approval = permissions.pending('chat')[0];
    if (!approval) throw new Error('Expected deletion approval');
    await expect(permissions.decide(approval.id, 'always', 'chat')).rejects.toThrow('each action');
    expect(await readFile(join(workspacePath, 'delete.txt'), 'utf8')).toBe(content);
    await permissions.decide(approval.id, 'once', 'chat');
    await pending;
    await expect(readFile(join(workspacePath, 'delete.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(permissions.decide(approval.id, 'once', 'chat')).rejects.toThrow(
      'no longer active',
    );
  }
});

it('rejects changed deletion targets and does not replay after cancellation', async () => {
  const { files, permissions, invocation, workspacePath } = await setup();
  await files.execute(
    {
      operation: 'write',
      path: 'keep.txt',
      content: 'Original',
    },
    invocation,
  );
  const pending = files.execute(
    {
      operation: 'delete',
      path: 'keep.txt',
    },
    invocation,
  );
  const changed = expect(pending).rejects.toThrow('target changed');
  await vi.waitFor(() => expect(permissions.pending('chat')).toHaveLength(1));
  await writeFile(join(workspacePath, 'keep.txt'), 'New content');
  await decide(permissions, 'once');
  await changed;
  expect(await readFile(join(workspacePath, 'keep.txt'), 'utf8')).toBe('New content');

  const controller = new AbortController();
  const cancelled = files.execute(
    {
      operation: 'delete',
      path: 'keep.txt',
    },
    {
      ...invocation,
      signal: controller.signal,
    },
  );
  const rejected = expect(cancelled).rejects.toThrow('cancelled or expired');
  await vi.waitFor(() => expect(permissions.pending('chat')).toHaveLength(1));
  controller.abort();
  await rejected;
  expect(permissions.pending('chat')).toEqual([]);
  expect(await readFile(join(workspacePath, 'keep.txt'), 'utf8')).toBe('New content');
});

it('rejects traversal, symbolic links, hard links and private paths before approval', async () => {
  const { files, invocation, workspacePath, home, permissions } = await setup();
  const external = await externalDirectory();
  await writeFile(join(external, 'secret.txt'), 'Outside secret');
  await symlink(external, join(workspacePath, 'escape'));
  await link(join(external, 'secret.txt'), join(workspacePath, 'hard.txt'));
  const view = await permissions.fileAccess();
  await permissions.saveFileAccess(
    {
      ...view.policy,
      global: true,
    },
    view.revision,
    true,
  );
  for (const path of [
    '../settings.yaml',
    'escape/secret.txt',
    'hard.txt',
    join(await realpath(home), 'settings.yaml'),
    '/proc/self/environ',
  ]) {
    await expect(
      files.execute(
        {
          operation: 'read',
          path,
        },
        invocation,
      ),
    ).rejects.toThrow();
    await expect(
      files.execute(
        {
          operation: 'write',
          path,
          content: 'Corrupt',
        },
        invocation,
      ),
    ).rejects.toThrow();
  }
  expect(permissions.pending('chat')).toEqual([]);
  expect(await readFile(join(external, 'secret.txt'), 'utf8')).toBe('Outside secret');
});

it('blocks case aliases of private files and denied directories on case-insensitive volumes', async () => {
  const { files, permissions, invocation, home } = await setup();
  const external = await externalDirectory();
  const restricted = join(external, 'Restricted');
  await mkdir(restricted);
  await writeFile(join(restricted, 'note.txt'), 'Do not expose');
  const view = await permissions.fileAccess();
  await permissions.saveFileAccess(
    {
      global: true,
      directories: [
        {
          path: restricted,
          access: 'deny',
        },
      ],
    },
    view.revision,
    true,
  );
  const canonicalHome = await realpath(home);
  const alias = join(
    dirname(canonicalHome),
    basename(canonicalHome).toUpperCase(),
    'settings.yaml',
  );
  await expect(
    files.execute(
      {
        operation: 'read',
        path: alias,
      },
      invocation,
    ),
  ).rejects.toThrow();
  await expect(
    files.execute(
      {
        operation: 'read',
        path: join(external, 'restricted', 'note.txt'),
      },
      invocation,
    ),
  ).rejects.toThrow();
  expect(permissions.pending('chat')).toEqual([]);
});

it('blocks alternate mount paths to private files and preserves directory restrictions and quotas', async () => {
  const { files, permissions, invocation, home, workspacePath } = await setup();
  const external = await externalDirectory();
  const view = await permissions.fileAccess();
  await permissions.saveFileAccess(
    {
      global: true,
      directories: [
        {
          path: external,
          access: 'deny',
        },
      ],
    },
    view.revision,
    true,
  );
  await writeFile(join(external, 'note.txt'), 'Private note');
  const canonicalHome = await realpath(home);
  const homeAlias = `/System/Volumes/Data${canonicalHome}`;
  const externalAlias = `/System/Volumes/Data${external}`;
  await expect(
    files.execute(
      {
        operation: 'read',
        path: join(existsSync(homeAlias) ? homeAlias : canonicalHome, 'settings.yaml'),
      },
      invocation,
    ),
  ).rejects.toThrow();
  await expect(
    files.execute(
      {
        operation: 'read',
        path: join(existsSync(externalAlias) ? externalAlias : external, 'note.txt'),
      },
      invocation,
    ),
  ).rejects.toThrow('denied');
  const quota = join(workspacePath, 'quota');
  await writeFile(quota, '');
  truncateSync(quota, 64 * 1024 * 1024);
  const workspaceAlias = join(homeAlias, 'workspace');
  await expect(
    files.execute(
      {
        operation: 'write',
        path: join(
          existsSync(workspaceAlias) ? workspaceAlias : join(canonicalHome, 'workspace'),
          'over-quota',
        ),
        content: 'No',
      },
      invocation,
    ),
  ).rejects.toThrow('quota');
});

it('upgrades one directory grant through an alternate mount without creating conflicting scopes', async () => {
  const { files, permissions, invocation } = await setup();
  const directory = await externalDirectory();
  const view = await permissions.fileAccess();
  await permissions.saveFileAccess(
    {
      global: false,
      directories: [
        {
          path: directory,
          access: 'read',
        },
      ],
    },
    view.revision,
    false,
  );
  const candidate = `/System/Volumes/Data${directory}`;
  const path = join(existsSync(candidate) ? candidate : directory, 'new.txt');
  const write = files.execute(
    {
      operation: 'write',
      path,
      content: 'New entry',
    },
    invocation,
  );
  await decide(permissions, 'always');
  await write;
  expect((await files.access()).policy.directories).toHaveLength(1);
  expect(
    await files.execute(
      {
        operation: 'read',
        path,
      },
      invocation,
    ),
  ).toMatchObject({
    text: 'New entry',
  });
});

it('resolves directory-rule casing without conflating distinct case-sensitive paths', async () => {
  const { files, permissions, invocation } = await setup();
  const external = await externalDirectory();
  const restricted = join(external, 'Restricted');
  await mkdir(restricted);
  await writeFile(join(restricted, 'note.txt'), 'Restricted contents');
  const alias = join(external, 'restricted');
  const view = await permissions.fileAccess();
  await permissions.saveFileAccess(
    {
      global: true,
      directories: [
        {
          path: alias,
          access: 'deny',
        },
      ],
    },
    view.revision,
    true,
  );
  const read = files.execute(
    {
      operation: 'read',
      path: join(restricted, 'note.txt'),
    },
    invocation,
  );
  if (existsSync(alias)) await expect(read).rejects.toThrow('denied');
  else
    expect(await read).toMatchObject({
      text: 'Restricted contents',
    });
});

it('bounds read, write and listing work and keeps the workspace within its quota', async () => {
  const { files, invocation, workspacePath, permissions } = await setup();
  await writeFile(join(workspacePath, 'large.txt'), 'a'.repeat(70000));
  expect(
    await files.execute(
      {
        operation: 'read',
        path: 'large.txt',
      },
      invocation,
    ),
  ).toMatchObject({
    text: 'a'.repeat(65536),
    nextOffset: 65536,
    more: true,
  });
  expect(
    await files.execute(
      {
        operation: 'read',
        path: 'large.txt',
        offset: 65536,
      },
      invocation,
    ),
  ).toMatchObject({
    text: 'a'.repeat(4464),
    more: false,
  });
  await expect(
    files.execute(
      {
        operation: 'write',
        path: 'oversized',
        content: 'é'.repeat(40000),
      },
      invocation,
    ),
  ).rejects.toThrow();
  for (let index = 0; index < 201; index++)
    await writeFile(join(workspacePath, `entry-${index}`), '');
  expect(
    await files.execute(
      {
        operation: 'list',
        path: '.',
      },
      invocation,
    ),
  ).toMatchObject({
    entries: expect.any(Array),
    more: true,
  });
  await writeFile(join(workspacePath, 'quota'), Buffer.alloc(64 * 1024 * 1024));
  await expect(
    files.execute(
      {
        operation: 'write',
        path: 'beyond-quota',
        content: 'No',
      },
      invocation,
    ),
  ).rejects.toThrow('quota');
  expect(permissions.pending('chat')).toEqual([]);
});

it('creates one directory at a time, refuses moves and directory deletion, and binds Never to the displayed directory', async () => {
  const { files, invocation, permissions } = await setup();
  await files.execute(
    {
      operation: 'mkdir',
      path: 'notes',
    },
    invocation,
  );
  await files.execute(
    {
      operation: 'write',
      path: 'notes/today.md',
      content: 'Notes',
    },
    invocation,
  );
  expect(
    await files.execute(
      {
        operation: 'read',
        path: 'notes/today.md',
      },
      invocation,
    ),
  ).toMatchObject({
    text: 'Notes',
  });
  await expect(
    files.execute(
      JSON.parse('{"operation":"move","path":"notes/today.md","destination":"other.md"}'),
      invocation,
    ),
  ).rejects.toThrow();
  await expect(
    files.execute(
      {
        operation: 'delete',
        path: 'notes',
      },
      invocation,
    ),
  ).rejects.toThrow('individual');
  const directory = await externalDirectory();
  const read = files.execute(
    {
      operation: 'list',
      path: directory,
    },
    invocation,
  );
  const rejected = expect(read).rejects.toThrow('denied');
  await decide(permissions, 'never');
  await rejected;
  await expect(
    files.execute(
      {
        operation: 'list',
        path: directory,
      },
      invocation,
    ),
  ).rejects.toThrow('denied');
  expect(permissions.pending('chat')).toEqual([]);
});

it('honors more-specific restrictions under a broad grant and fails closed after revocation or invalid settings', async () => {
  const { files, invocation, permissions, settings, home } = await setup();
  const external = await externalDirectory();
  const child = join(external, 'private');
  await mkdir(child);
  await writeFile(join(child, 'note'), 'Restricted');
  const view = await permissions.fileAccess();
  await permissions.saveFileAccess(
    {
      global: true,
      directories: [
        {
          path: external,
          access: 'read-write',
        },
        {
          path: child,
          access: 'deny',
        },
      ],
    },
    view.revision,
    true,
  );
  await expect(
    files.execute(
      {
        operation: 'read',
        path: join(child, 'note'),
      },
      invocation,
    ),
  ).rejects.toThrow('denied');
  expect(permissions.pending('chat')).toEqual([]);

  const current = await settings.view();
  await writeFile(join(home, 'settings.yaml'), 'invalid: yaml');
  await expect(
    files.execute(
      {
        operation: 'list',
        path: '.',
      },
      invocation,
    ),
  ).rejects.toThrow('Repair');
  await writeFile(join(home, 'settings.yaml'), JSON.stringify(current.active));
  const pendingPath = join(external, 'pending.txt');
  await writeFile(pendingPath, 'Keep');
  const action = files.execute(
    {
      operation: 'delete',
      path: pendingPath,
    },
    invocation,
  );
  const rejected = expect(action).rejects.toThrow('settings changed');
  await vi.waitFor(() => expect(permissions.pending('chat')).toHaveLength(1));
  const active = await permissions.fileAccess();
  await permissions.saveFileAccess(
    {
      ...active.policy,
      global: false,
    },
    active.revision,
    false,
  );
  await decide(permissions, 'once');
  await rejected;
});
