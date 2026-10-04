import { expect, test } from '../../../tests/browser.js';

test('keeps the first draft when conversation loading is slow', async ({ page, clef }) => {
  await clef.setup();
  let release = () => {};
  const loading = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/conversation/events', async (route) => {
    await loading;
    await route.continue();
  });
  await page.goto(clef.url);
  const input = page.getByRole('textbox', {
    name: 'Message',
    exact: true,
  });
  await input.fill('First line');
  await input.press('Shift+Enter');
  await input.pressSequentially('Second line');
  await expect(
    page.getByRole('button', {
      name: 'Send message',
    }),
  ).toBeDisabled();
  release();
  await expect(
    page.getByText('Connected', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(input).toHaveValue('First line\nSecond line');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText('First line');
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText('Second line');
});
