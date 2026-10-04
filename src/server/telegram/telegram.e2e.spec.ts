import { test as base, expect } from '../../../tests/browser.js';

type Bot = {
  updates: Array<{
    update_id: number;
    message: {
      message_id: number;
      chat: {
        id: number;
        type: string;
      };
      from: {
        id: number;
        is_bot: boolean;
      };
      text: string;
    };
  }>;
  sent: Array<{
    chat_id: number;
    text: string;
  }>;
};

const test = base.extend<{
  bot: Bot;
}>({
  bot: {
    updates: [],
    sent: [],
  },
  telegramFetch: async ({ bot }, use) => {
    await use(async (input, init) => {
      const method = String(input).split('/').at(-1);
      const body = JSON.parse(String(init?.body));
      let result: unknown;
      if (method === 'getMe')
        result = {
          id: 123,
          username: 'clef_test_bot',
          is_bot: true,
        };
      if (method === 'getWebhookInfo')
        result = {
          url: '',
        };
      if (method === 'getUpdates') {
        await new Promise((resolve) => setTimeout(resolve, 25));
        result = bot.updates.filter((update) => update.update_id >= body.offset);
      }
      if (method === 'sendMessage') {
        bot.sent.push(body);
        result = {
          message_id: bot.sent.length,
        };
      }
      return Response.json({
        ok: true,
        result,
      });
    });
  },
});

function incoming(bot: Bot, text: string) {
  const id = bot.updates.length + 1;
  bot.updates.push({
    update_id: id,
    message: {
      message_id: id,
      from: {
        id: 42,
        is_bot: false,
      },
      chat: {
        id: 42,
        type: 'private',
      },
      text,
    },
  });
}

test('connects and pairs Telegram in Settings, shares web chat, and disconnects after restart', async ({
  page,
  clef,
  bot,
}) => {
  expect((await page.request.get(`${clef.url}/api/telegram`)).status()).toBe(401);
  await clef.setup();
  expect((await page.request.get(`${clef.url}/api/telegram`)).status()).toBe(200);
  await page.goto(clef.url);
  await page
    .getByRole('button', {
      name: 'Settings',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Channels',
      exact: true,
    })
    .click();
  await page
    .getByText('Telegram', {
      exact: true,
    })
    .click();
  const token = page.getByLabel('Telegram bot token');
  await expect(token).toHaveAttribute('type', 'password');
  await page.emulateMedia({
    colorScheme: 'light',
  });
  await expect(token).toHaveCSS('color-scheme', 'light');
  await page.emulateMedia({
    colorScheme: 'dark',
  });
  await expect(token).toHaveCSS('color-scheme', 'dark');
  await token.fill('123:abcdefghijklmnopqrstuvwxyz');
  await page
    .getByRole('button', {
      name: 'Connect Telegram',
      exact: true,
    })
    .click();
  const pairing = page.getByRole('link', {
    name: 'Open Telegram to pair',
  });
  await expect(pairing).toBeVisible();
  const url = await pairing.getAttribute('href');
  expect(url).toBeTruthy();
  incoming(bot, `/start ${new URL(url ?? '').searchParams.get('start')}`);
  await expect(page.getByText('Paired Telegram account: 42')).toBeVisible();
  await expect(pairing).toHaveCount(0);
  await page
    .getByRole('button', {
      name: 'Close',
      exact: true,
    })
    .click();
  incoming(bot, 'Remember my Telegram note');
  await expect
    .poll(() => bot.sent.map((item) => item.text))
    .toContain('Clef heard: Remember my Telegram note');
  await expect(
    page.getByRole('article', {
      name: 'Your message',
    }),
  ).toContainText('Remember my Telegram note');
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText('Clef heard: Remember my Telegram note');
  await clef.restart();
  await page.reload();
  await page
    .getByRole('button', {
      name: 'Settings',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Channels',
      exact: true,
    })
    .click();
  await page
    .getByText('Telegram', {
      exact: true,
    })
    .click();
  await expect(page.getByText('Paired Telegram account: 42')).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Disconnect Telegram',
      exact: true,
    })
    .click();
  await expect(page.getByLabel('Telegram bot token')).toBeVisible();
  await expect(page.getByText('Paired Telegram account: 42')).toHaveCount(0);
});
