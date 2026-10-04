import { expect, test } from '../../../tests/browser.js';

test('streams a reply, reconnects after reload, and retains it after server restart', async ({
  page,
  clef,
}) => {
  await clef.setup();
  await page.goto(clef.url);
  await page.getByPlaceholder('Message Clef…').fill('Remember the blue notebook');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Stop reply',
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('log', {
      name: 'Conversation',
    }),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole('article', {
        name: 'Clef reply',
      })
      .getByRole('paragraph'),
  ).toHaveText('Clef heard: Remember the blue notebook');
  await page.reload();
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText('Remember the blue notebook');
  await clef.restart();
  await page.reload();
  await expect(
    page.getByRole('article', {
      name: 'Your message',
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText('Remember the blue notebook');
  await page
    .getByRole('button', {
      name: 'New conversation',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'What’s on your mind?',
    }),
  ).toBeVisible();
  await page
    .getByRole('navigation', {
      name: 'Conversations',
    })
    .getByRole('button', {
      name: 'Remember the blue notebook',
    })
    .click();
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText('Remember the blue notebook');
  await test.info().attach('chat', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('stops a live reply and can send another message', async ({ page, clef }) => {
  await clef.setup();
  await page.goto(clef.url);
  await page.getByPlaceholder('Message Clef…').fill('Please send a slow response');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText('A slow');
  await page
    .getByRole('button', {
      name: 'Stop reply',
    })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Stop reply',
    }),
  ).toHaveCount(0);
  await page.getByPlaceholder('Message Clef…').fill('Now a short reply');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  await expect(
    page
      .getByRole('article', {
        name: 'Clef reply',
      })
      .last(),
  ).toContainText('Clef heard: Now a short reply');
});
