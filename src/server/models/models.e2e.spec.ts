import { expect, test } from '../../../tests/browser.js';

test('changes defaults only for new conversations and replaces a provider connection', async ({
  page,
  clef,
}) => {
  await clef.setup();
  await page.goto(clef.url);
  await expect(
    page.getByText('test-model', {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Settings',
    })
    .click();
  await page
    .getByRole('combobox', {
      name: 'Model',
      exact: true,
    })
    .click();
  await page
    .getByRole('option', {
      name: 'Second model',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Save defaults',
    })
    .click();
  await expect(
    page.getByText('test-model', {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'New conversation',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('second-model', {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Settings',
    })
    .click();
  await page
    .getByText('Manage connections', {
      exact: true,
    })
    .click();
  await page
    .getByText('Use an API key instead', {
      exact: true,
    })
    .click();
  await page
    .getByLabel('API key', {
      exact: true,
    })
    .fill('replacement-test-api-key');
  await page
    .getByRole('button', {
      name: 'Connect provider',
    })
    .click();
  await expect(
    page.getByRole('dialog', {
      name: 'Settings',
    }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText('second-model', {
      exact: true,
    }),
  ).toBeVisible();
});
