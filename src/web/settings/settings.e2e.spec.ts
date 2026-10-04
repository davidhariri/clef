import { expect, test } from '../../../tests/browser.js';

test('shows one settings section at a time and returns to chat with Escape', async ({
  page,
  clef,
}) => {
  await clef.setup();
  await page.goto(clef.url);
  const trigger = page.getByRole('button', {
    name: 'Settings',
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole('dialog', {
    name: 'Settings',
  });
  const navigation = dialog.getByRole('navigation', {
    name: 'Settings sections',
  });
  await expect(navigation).toBeVisible();
  await expect(
    dialog.getByRole('heading', {
      name: 'Default model',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', {
      name: 'Sign out',
      exact: true,
    }),
  ).toHaveCount(0);

  await navigation
    .getByRole('button', {
      name: 'Tools',
      exact: true,
    })
    .click();
  await expect(
    dialog.getByRole('heading', {
      name: 'Tools',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByText('Not enabled', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('combobox', {
      name: 'Model',
      exact: true,
    }),
  ).toHaveCount(0);

  await navigation
    .getByRole('button', {
      name: 'Account',
      exact: true,
    })
    .click();
  await expect(
    dialog.getByRole('button', {
      name: 'Sign out',
      exact: true,
    }),
  ).toBeVisible();
  await navigation
    .getByRole('button', {
      name: 'Default model',
      exact: true,
    })
    .click();
  await expect(
    dialog.getByRole('combobox', {
      name: 'Model',
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
