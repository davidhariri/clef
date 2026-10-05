import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '../../../tests/browser.js';

test('manages directory access and confirms global access in Settings across system appearances', async ({
  page,
  clef,
}) => {
  const journal = await realpath(await mkdtemp(join(tmpdir(), 'clef-settings-journal-')));
  try {
    await clef.setup();
    await page.goto(clef.url);
    await page
      .getByRole('button', {
        name: 'Settings',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Settings',
      exact: true,
    });
    await dialog
      .getByRole('button', {
        name: 'File access',
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText(await realpath(join(clef.home, 'workspace')), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByText('Global access is off.', {
        exact: true,
      }),
    ).toBeVisible();
    for (const colorScheme of [
      'dark',
      'light',
    ] as const) {
      await page.emulateMedia({
        colorScheme,
      });
      await expect(dialog.getByLabel('Directory path')).toHaveCSS('color-scheme', colorScheme);
      await expect(
        dialog.getByRole('combobox', {
          name: 'New directory access',
          exact: true,
        }),
      ).toHaveCSS('color-scheme', colorScheme);
    }
    await dialog.getByLabel('Directory path').fill(journal);
    await dialog
      .getByRole('button', {
        name: 'Add directory',
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText(journal, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('combobox', {
        name: `Access for ${journal}`,
        exact: true,
      }),
    ).toContainText('Read only');
    await dialog
      .getByRole('combobox', {
        name: `Access for ${journal}`,
        exact: true,
      })
      .click();
    await page
      .getByRole('option', {
        name: 'Read and write',
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${clef.url}/api/files/access`)).json()).policy
            .directories,
      )
      .toContainEqual({
        path: journal,
        access: 'read-write',
      });
    await dialog
      .getByRole('button', {
        name: 'Enable global access',
        exact: true,
      })
      .click();
    const confirmation = page.getByRole('dialog', {
      name: 'Enable global host file access?',
    });
    await expect(confirmation).toBeVisible();
    await confirmation
      .getByRole('button', {
        name: 'Cancel',
        exact: true,
      })
      .click();
    expect(
      (await (await page.request.get(`${clef.url}/api/files/access`)).json()).policy.global,
    ).toBe(false);
    await dialog
      .getByRole('button', {
        name: 'Enable global access',
        exact: true,
      })
      .click();
    await confirmation
      .getByRole('button', {
        name: 'I understand. Enable global access',
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText('Global access is on.', {
        exact: true,
      }),
    ).toBeVisible();
    await clef.restart();
    await page.reload();
    await page
      .getByRole('button', {
        name: 'Settings',
        exact: true,
      })
      .click();
    await dialog
      .getByRole('button', {
        name: 'File access',
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText('Global access is on.', {
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByRole('button', {
        name: 'Disable global access',
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText('Global access is off.', {
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByRole('button', {
        name: `Remove rule for ${journal}`,
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText(journal, {
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await rm(journal, {
      recursive: true,
      force: true,
    });
  }
});
