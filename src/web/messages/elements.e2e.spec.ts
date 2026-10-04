import { expect, test } from '../../../tests/browser.js';

test('copies a rendered reply and closes Settings with Escape', async ({ page, clef }) => {
  await page.context().grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ]);
  await clef.setup();
  await page.goto(clef.url);

  await page
    .getByRole('textbox', {
      name: 'Message',
      exact: true,
    })
    .fill('A copyable reply');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  const reply = page.getByRole('article', {
    name: 'Clef reply',
  });
  await expect(reply).toContainText('Clef heard: A copyable reply');
  await reply
    .getByRole('button', {
      name: 'Copy reply',
      exact: true,
    })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('Clef heard: A copyable reply');

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
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', {
      name: 'Settings',
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Settings',
      exact: true,
    }),
  ).toBeFocused();
});

test('uses Enter to send, Shift+Enter for a new line, and preserves a selected conversation', async ({
  page,
  clef,
}) => {
  await clef.setup();
  await page.goto(clef.url);

  const input = page.getByRole('textbox', {
    name: 'Message',
    exact: true,
  });
  await input.fill('First line');
  await input.press('Shift+Enter');
  await input.pressSequentially('Second line');
  await expect(input).toHaveValue('First line\nSecond line');
  await expect(page.getByRole('article')).toHaveCount(0);
  await input.press('Enter');

  const reply = page.getByRole('article', {
    name: 'Clef reply',
  });
  await expect(reply).toContainText('Second line');
  await expect(input).toHaveValue('');
  await page
    .getByRole('navigation', {
      name: 'Conversations',
    })
    .getByRole('button')
    .click();
  await expect(reply).toHaveCount(1);
  await expect(reply).toContainText('First line');
  await expect(
    page.getByRole('log', {
      name: 'Conversation',
    }),
  ).toHaveCount(1);
});

test('keeps a rejected draft and reuses its request ID until the text changes', async ({
  page,
  clef,
}) => {
  await clef.setup();
  await page.goto(clef.url);
  const requestIds: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/messages'))
      requestIds.push(request.postDataJSON().requestId);
  });

  const input = page.getByRole('textbox', {
    name: 'Message',
    exact: true,
  });
  const draft = 'x'.repeat(32001);
  await input.fill(draft);

  for (let attempt = 0; attempt < 2; attempt++) {
    const rejected = page.waitForResponse(
      (response) => response.url().endsWith('/messages') && response.status() === 400,
    );
    await page
      .getByRole('button', {
        name: 'Send message',
      })
      .click();
    await rejected;
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(input).toHaveValue(draft);
  }

  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
  await input.fill('A valid message');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  await expect(
    page.getByRole('article', {
      name: 'Clef reply',
    }),
  ).toContainText('Clef heard: A valid message');
  await expect(
    page.getByRole('article', {
      name: 'Your message',
    }),
  ).toHaveCount(1);
  await expect(input).toHaveValue('');
  expect(requestIds[2]).not.toBe(requestIds[0]);
});

test('renders Markdown without HTML, script links, or automatic remote images', async ({
  page,
  clef,
}) => {
  await clef.setup();
  await page.goto(clef.url);
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://example.com/')) remoteRequests.push(request.url());
  });

  await page
    .getByRole('textbox', {
      name: 'Message',
      exact: true,
    })
    .fill(
      [
        '[safe link](https://example.com/page)',
        '![remote image](https://example.com/tracker.png)',
        '<script>window.unsafeMarkupExecuted = true</script>',
        '<img src="https://example.com/raw.png" onerror="window.unsafeMarkupExecuted = true">',
        '[unsafe link](javascript:alert(1))',
        '| Name | Value |\n| --- | --- |\n| answer | 42 |',
      ].join('\n\n'),
    );
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();

  const reply = page.getByRole('article', {
    name: 'Clef reply',
  });
  await expect(reply.getByRole('table')).toContainText('42');
  await expect(
    reply.getByRole('link', {
      name: 'safe link',
      exact: true,
    }),
  ).toHaveAttribute('href', 'https://example.com/page');
  await expect(
    reply.getByRole('link', {
      name: 'remote image',
      exact: true,
    }),
  ).toHaveAttribute('href', 'https://example.com/tracker.png');
  await expect(
    page.locator('article img, article script, article iframe, article a[href^="javascript:"]'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => Object.hasOwn(window, 'unsafeMarkupExecuted'))).toBe(false);
  expect(remoteRequests).toEqual([]);
});

test('rejects pasted files rather than silently dropping unsupported attachments', async ({
  page,
  clef,
}) => {
  await clef.setup();
  await page.goto(clef.url);
  const input = page.getByRole('textbox', {
    name: 'Message',
    exact: true,
  });
  await input.fill('My draft');
  await input.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File(
        [
          'example',
        ],
        'example.txt',
        {
          type: 'text/plain',
        },
      ),
    );
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(page.getByRole('alert')).toHaveText(
    'Attachments are not supported yet. Send text only.',
  );
  await expect(input).toHaveValue('My draft');
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('scrolls a long conversation on a narrow screen', async ({ page, clef }) => {
  await page.setViewportSize({
    width: 390,
    height: 780,
  });
  await clef.setup();
  await page.goto(clef.url);
  await page
    .getByRole('textbox', {
      name: 'Message',
      exact: true,
    })
    .fill('A long message. '.repeat(80));
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();

  const copy = page.getByRole('button', {
    name: 'Copy reply',
    exact: true,
  });
  await expect(copy).toBeEnabled();
  await expect(copy).toBeInViewport();
  await page
    .getByRole('log', {
      name: 'Conversation',
    })
    .hover();
  await page.mouse.wheel(0, -10000);
  await page
    .getByRole('button', {
      name: 'Scroll to latest message',
    })
    .click();
  await expect(copy).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await test.info().attach('chat-mobile', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
