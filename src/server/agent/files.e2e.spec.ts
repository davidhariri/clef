import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../../../tests/browser.js';

async function sendFile(page: Page, command: Record<string, unknown>) {
  await page.getByPlaceholder('Message Clef…').fill(`file ${JSON.stringify(command)}`);
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
}

const reply = (page: Page) =>
  page
    .getByRole('article', {
      name: 'Clef reply',
    })
    .last();

test('uses checked file tools and asks for each deletion in web chat', async ({ page, clef }) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'clef-journal-')));
  const journal = join(directory, 'today.md');
  await writeFile(journal, 'Journal entry');
  try {
    await clef.setup();
    await page.goto(clef.url);
    await sendFile(page, {
      operation: 'write',
      path: 'note.md',
      content: 'Workspace note',
    });
    await expect(reply(page)).toContainText('File action completed.');
    expect(await readFile(join(clef.home, 'workspace', 'note.md'), 'utf8')).toBe('Workspace note');
    await sendFile(page, {
      operation: 'read',
      path: journal,
    });
    const approval = page.getByRole('region', {
      name: 'File approval',
    });
    await expect(approval).toContainText(directory);
    await expect(approval).toContainText('Read only');
    await approval
      .getByRole('button', {
        name: 'Always',
        exact: true,
      })
      .click();
    await expect(reply(page)).toContainText('Journal entry');
    await clef.restart();
    await page.reload();
    await sendFile(page, {
      operation: 'read',
      path: journal,
    });
    await expect(reply(page)).toContainText('Journal entry');
    await expect(approval).toHaveCount(0);

    await sendFile(page, {
      operation: 'delete',
      path: 'note.md',
    });
    await expect(approval).toContainText('Delete this file?');
    await expect(
      approval.getByRole('button', {
        name: 'Always',
        exact: true,
      }),
    ).toHaveCount(0);
    await approval
      .getByRole('button', {
        name: 'Deny',
        exact: true,
      })
      .click();
    await expect(reply(page)).toContainText('File action rejected.');
    expect(await readFile(join(clef.home, 'workspace', 'note.md'), 'utf8')).toBe('Workspace note');
    await sendFile(page, {
      operation: 'delete',
      path: 'note.md',
    });
    await expect(approval).toBeVisible();
    await approval
      .getByRole('button', {
        name: 'This time',
        exact: true,
      })
      .click();
    await expect(reply(page)).toContainText('File action completed.');
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

test('restart cancels a pending deletion without replaying it', async ({ page, clef }) => {
  await clef.setup();
  await page.goto(clef.url);
  await sendFile(page, {
    operation: 'write',
    path: 'keep.txt',
    content: 'Keep after restart',
  });
  await expect(reply(page)).toContainText('File action completed.');
  await sendFile(page, {
    operation: 'delete',
    path: 'keep.txt',
  });
  await expect(
    page.getByRole('region', {
      name: 'File approval',
    }),
  ).toBeVisible();
  const snapshot = await (await page.request.get(`${clef.url}/api/conversation`)).json();
  const approvalId = snapshot.permissions[0].id;
  await clef.restart();
  await page.reload();
  await expect(
    page.getByRole('region', {
      name: 'File approval',
    }),
  ).toHaveCount(0);
  const late = await page.request.post(`${clef.url}/api/conversation/permissions/${approvalId}`, {
    data: {
      choice: 'once',
    },
  });
  expect(late.status()).toBe(409);
  expect(await readFile(join(clef.home, 'workspace', 'keep.txt'), 'utf8')).toBe(
    'Keep after restart',
  );
  await sendFile(page, {
    operation: 'read',
    path: 'keep.txt',
  });
  await expect(reply(page)).toContainText('Keep after restart');
});
