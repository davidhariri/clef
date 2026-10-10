import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '../../../tests/api.js';

test('uses checked file tools and requires approval for each deletion', async ({ clef }) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'clef-journal-')));
  const journal = join(directory, 'today.md');
  await writeFile(journal, 'Journal entry');
  const reply = async () => {
    const snapshot = await clef.snapshot();
    return snapshot.busy ? undefined : snapshot.messages.at(-1)?.text;
  };
  try {
    await clef.connect();
    await clef.send(
      `file ${JSON.stringify({
        operation: 'write',
        path: 'note.md',
        content: 'Workspace note',
      })}`,
    );
    await expect.poll(reply).toContain('File action completed.');
    expect(await readFile(join(clef.home, 'workspace', 'note.md'), 'utf8')).toBe('Workspace note');
    await clef.send(
      `file ${JSON.stringify({
        operation: 'read',
        path: journal,
      })}`,
    );
    await expect.poll(async () => (await clef.snapshot()).permissions.length).toBe(1);
    const approval = (await clef.snapshot()).permissions[0];
    expect(approval).toMatchObject({
      kind: 'file',
      directory,
      operation: 'read',
    });
    expect(
      (
        await clef.request.post(`/api/conversation/permissions/${approval?.id}`, {
          data: {
            choice: 'always',
          },
        })
      ).ok(),
    ).toBe(true);
    await expect.poll(reply).toContain('Journal entry');
    await clef.restart();
    await clef.send(
      `file ${JSON.stringify({
        operation: 'read',
        path: journal,
      })}`,
    );
    await expect.poll(reply).toContain('Journal entry');
    expect((await clef.snapshot()).permissions).toHaveLength(0);

    await clef.send(
      `file ${JSON.stringify({
        operation: 'delete',
        path: 'note.md',
      })}`,
    );
    await expect.poll(async () => (await clef.snapshot()).permissions.length).toBe(1);
    const deletion = (await clef.snapshot()).permissions[0];
    expect(deletion).toMatchObject({
      kind: 'file',
      operation: 'delete',
    });
    expect(
      (
        await clef.request.post(`/api/conversation/permissions/${deletion?.id}`, {
          data: {
            choice: 'always',
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await clef.request.post(`/api/conversation/permissions/${deletion?.id}`, {
          data: {
            choice: 'deny',
          },
        })
      ).ok(),
    ).toBe(true);
    await expect.poll(reply).toContain('File action rejected.');
    expect(await readFile(join(clef.home, 'workspace', 'note.md'), 'utf8')).toBe('Workspace note');
    await clef.send(
      `file ${JSON.stringify({
        operation: 'delete',
        path: 'note.md',
      })}`,
    );
    await expect.poll(async () => (await clef.snapshot()).permissions.length).toBe(1);
    const approved = (await clef.snapshot()).permissions[0];
    expect(
      (
        await clef.request.post(`/api/conversation/permissions/${approved?.id}`, {
          data: {
            choice: 'once',
          },
        })
      ).ok(),
    ).toBe(true);
    await expect.poll(reply).toContain('File action completed.');
    await expect(readFile(join(clef.home, 'workspace', 'note.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test('rejects cross-conversation deletion approval and cancels pending deletion on restart', async ({
  clef,
}) => {
  await clef.connect();
  await clef.send(
    `file ${JSON.stringify({
      operation: 'write',
      path: 'keep.txt',
      content: 'Keep after restart',
    })}`,
  );
  await expect
    .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
    .toContain('File action completed.');
  await expect.poll(async () => (await clef.snapshot()).busy).toBe(false);
  await clef.send(
    `file ${JSON.stringify({
      operation: 'delete',
      path: 'keep.txt',
    })}`,
  );
  await expect.poll(async () => (await clef.snapshot()).permissions.length).toBe(1);
  const snapshot = await clef.snapshot();
  const approvalId = snapshot.permissions[0]?.id;
  expect(
    (
      await clef.request.post('/api/conversations', {
        data: {},
      })
    ).ok(),
  ).toBe(true);
  const other = await clef.request.post(`/api/conversation/permissions/${approvalId}`, {
    data: {
      choice: 'once',
    },
  });
  expect(other.status()).toBe(409);
  await clef.restart();
  const restored = await (
    await clef.request.get(`/api/conversation?id=${snapshot.conversation.id}`)
  ).json();
  expect(restored.permissions).toHaveLength(0);
  const late = await clef.request.post(
    `/api/conversation/permissions/${approvalId}?id=${snapshot.conversation.id}`,
    {
      data: {
        choice: 'once',
      },
    },
  );
  expect(late.status()).toBe(409);
  expect(await readFile(join(clef.home, 'workspace', 'keep.txt'), 'utf8')).toBe(
    'Keep after restart',
  );
  await clef.send(
    `file ${JSON.stringify({
      operation: 'read',
      path: 'keep.txt',
    })}`,
  );
  await expect
    .poll(async () => (await clef.snapshot()).messages.at(-1)?.text)
    .toContain('Keep after restart');
});
