import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '../../../tests/browser.js';

test('keeps the first draft when conversation loading is slow', async ({ page, clef }) => {
  await clef.setup();
  await page.route('**/api/conversations', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();

    const response = await route.fetch();
    await delay(500);
    await route.fulfill({
      response,
    });
  });
  await page.goto(clef.url);
  const input = page.getByRole('textbox', {
    name: 'Message',
    exact: true,
  });
  await input.fill('First line');
  await input.press('Shift+Enter');
  await input.pressSequentially('Second line');
  await expect(page).toHaveURL(/#chat=/);
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
