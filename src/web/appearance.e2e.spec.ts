import { expect, test } from '../../tests/browser.js';

test('follows system appearance on setup and keeps only useful supporting text', async ({
  page,
  clef,
}) => {
  await page.emulateMedia({
    colorScheme: 'dark',
  });
  await page.goto(clef.setupUrl);

  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  const darkBackground = await page
    .locator('body')
    .evaluate((body) => getComputedStyle(body).backgroundColor);
  await expect(page.getByLabel('Username')).toHaveCSS('color-scheme', 'dark');
  await expect(page.getByText('Your assistant. Your computer. Your space.')).toHaveCount(0);
  await expect(page.getByText('Stored here. Connected on your terms.')).toHaveCount(0);
  await expect(
    page.getByText('Save this key outside Clef.', {
      exact: false,
    }),
  ).toBeVisible();

  await page.emulateMedia({
    colorScheme: 'light',
  });

  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect(page.locator('body')).not.toHaveCSS('background-color', darkBackground);
  await expect(page.getByLabel('Username')).toHaveCSS('color-scheme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
});

for (const scheme of [
  'light',
  'dark',
] as const) {
  test(`renders chat, settings, and shared color tokens in ${scheme} mode`, async ({
    page,
    clef,
  }) => {
    await page.emulateMedia({
      colorScheme: scheme,
    });
    await clef.setup();
    await page.goto(clef.url);

    await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);
    await expect(page.getByText('A little more personal.')).toHaveCount(0);
    await expect(page.getByText('A question, an idea, or a place to start.')).toHaveCount(0);
    await expect(
      page.getByText('Your chosen model receives this conversation.', {
        exact: false,
      }),
    ).toBeVisible();

    await page
      .getByPlaceholder('Message Clef…')
      .fill('Theme preview\n\n```js\nconst answer = 42;\n```');
    await page
      .getByRole('button', {
        name: 'Send message',
      })
      .click();
    await expect(
      page.getByRole('article', {
        name: 'Clef reply',
      }),
    ).toContainText('const answer = 42;');
    await expect(
      page
        .getByRole('article', {
          name: 'Clef reply',
        })
        .locator('pre'),
    ).toBeVisible();
    await expect(
      page
        .getByRole('article', {
          name: 'Clef reply',
        })
        .getByRole('button', {
          name: 'Copy reply',
          exact: true,
        }),
    ).toBeEnabled();
    await test.info().attach(`chat-${scheme}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await page
      .getByRole('button', {
        name: 'Settings',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('dialog', {
        name: 'Settings',
      }),
    ).toHaveCSS(
      'background-color',
      await page.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor),
    );
    await expect(
      page.getByRole('combobox', {
        name: 'Model',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('dialog', {
        name: 'Settings',
      }),
    ).toHaveCSS('opacity', '1');
    await test.info().attach(`settings-${scheme}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await page.evaluate(() =>
      document.documentElement.style.setProperty('--background', 'rgb(40, 50, 60)'),
    );
    await expect(
      page.getByRole('dialog', {
        name: 'Settings',
      }),
    ).toHaveCSS('background-color', 'rgb(40, 50, 60)');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(40, 50, 60)');
  });
}
