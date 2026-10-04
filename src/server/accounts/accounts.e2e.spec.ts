import { expect, test } from '../../../tests/browser.js';

test('sets up the account, completes provider sign-in, and signs back in', async ({
  page,
  clef,
}) => {
  await page.goto(clef.setupUrl);
  await page.getByLabel('Username').fill('david');
  await page
    .getByLabel('Password', {
      exact: true,
    })
    .fill('a long test password');
  await page
    .getByRole('button', {
      name: 'Generate key',
    })
    .click();
  await page.getByLabel('I saved my recovery key').check();
  await page
    .getByRole('button', {
      name: 'Create account',
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Sign in with ChatGPT',
    })
    .click();
  await expect(
    page.getByRole('link', {
      name: 'Open provider sign-in',
    }),
  ).toBeVisible();
  await page.getByLabel('Sign-in response').fill('test-callback');
  await page
    .getByRole('button', {
      name: 'Complete sign-in',
    })
    .click();
  await expect(page.getByPlaceholder('Message Clef…')).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Settings',
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Sign out',
    })
    .click();
  await page.getByLabel('Username').fill('david');
  await page
    .getByLabel('Password', {
      exact: true,
    })
    .fill('a long test password');
  await page
    .getByRole('button', {
      name: 'Sign in',
      exact: true,
    })
    .click();
  await expect(page.getByPlaceholder('Message Clef…')).toBeVisible();
});
