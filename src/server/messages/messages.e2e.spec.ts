import { expect, test } from '../../../tests/browser.js';

test('opens the same persistent chat for concurrent clients', async ({ page, clef }) => {
  await clef.setup();
  const responses = await Promise.all([
    page.request.get(`${clef.url}/api/conversation`),
    page.request.get(`${clef.url}/api/conversation`),
  ]);
  for (const response of responses) expect(response.status()).toBe(200);

  const [first, second] = await Promise.all(responses.map((response) => response.json()));
  expect(first.conversation.id).toBe(second.conversation.id);
  await clef.restart();
  const restored = await page.request.get(`${clef.url}/api/conversation`);
  expect(restored.status()).toBe(200);
  expect((await restored.json()).conversation.id).toBe(first.conversation.id);
});

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
  await expect(page).toHaveURL(clef.url);
  await expect(page.getByRole('navigation')).toHaveCount(0);
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
