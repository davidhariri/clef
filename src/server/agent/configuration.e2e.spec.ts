import type { Page } from '@playwright/test';
import { expect, test } from '../../../tests/browser.js';
import { snapshotSchema } from '../messages/contract.js';
import { settingsViewSchema } from '../settings/contract.js';

async function send(page: Page, text: string) {
  await page.getByPlaceholder('Message Clef…').fill(text);
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
}

async function settings(page: Page, url: string) {
  return settingsViewSchema.parse(await (await page.request.get(`${url}/api/settings`)).json());
}

async function snapshot(page: Page, url: string) {
  return snapshotSchema.parse(await (await page.request.get(`${url}/api/conversation`)).json());
}

for (const [name, overrides] of Object.entries({
  policy: {
    permissions: [
      {
        origin: 'https://untrusted.example',
        method: 'GET',
        decision: 'allow',
      },
    ],
  },
  oversized: {
    defaults: {
      provider: 'openai',
      modelId: 'x'.repeat(121),
      thinkingLevel: 'off',
    },
  },
  unknownModel: {
    defaults: {
      provider: 'openai',
      modelId: 'missing',
      thinkingLevel: 'off',
    },
  },
})) {
  test.describe(`untrusted ${name} input`, () => {
    test.use({
      configurationOverrides: overrides,
    });
    test('rejects the tool call without an approval or settings change', async ({ page, clef }) => {
      await clef.setup();
      const before = await settings(page, clef.url);
      await page.goto(clef.url);
      await send(page, 'configure switch');
      await expect(
        page
          .getByRole('article', {
            name: 'Clef reply',
          })
          .last(),
      ).toContainText('Configuration finished on test-model. Rejected.');
      expect(await settings(page, clef.url)).toEqual(before);
      expect((await snapshot(page, clef.url)).permissions).toEqual([]);
    });
  });
}

test.describe('bounded inspection', () => {
  test.use({
    modelName: 'x'.repeat(16384),
  });
  test('rejects an oversized tool result before returning it to the model', async ({
    page,
    clef,
  }) => {
    await clef.setup();
    const before = await settings(page, clef.url);
    await page.goto(clef.url);
    await send(page, 'configure switch');
    await expect(
      page
        .getByRole('article', {
          name: 'Clef reply',
        })
        .last(),
    ).toContainText('Configuration inspection rejected.');
    const view = await snapshot(page, clef.url);
    expect(view.permissions).toEqual([]);
    expect(view.messages.filter((message) => message.role === 'tool')).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('exceeds 16 KiB'),
      }),
    ]);
    expect(JSON.stringify(view)).not.toContain('x'.repeat(16384));
    expect(await settings(page, clef.url)).toEqual(before);
  });
});

for (const choice of [
  'Deny',
  'Never',
]) {
  test(`${choice} blocks writes and switches without leaking secrets`, async ({ page, clef }) => {
    await clef.setup();
    const before = await settings(page, clef.url);
    await page.goto(clef.url);
    await send(page, 'configure switch');
    const approval = page.getByRole('region', {
      name: 'Configuration approval',
    });
    await expect(approval).toBeVisible();
    const pending = await snapshot(page, clef.url);
    const request = pending.permissions[0];
    expect(request).toMatchObject({
      kind: 'configuration',
      conversationId: pending.conversation.id,
      revision: before.revision,
      defaults: {
        provider: 'openai',
        modelId: 'second-model',
        thinkingLevel: 'off',
      },
      switchConversation: true,
    });
    expect(JSON.stringify(pending)).not.toContain('test-api-key');
    expect(JSON.stringify(pending)).not.toContain('a'.repeat(64));
    expect(await settings(page, clef.url)).toEqual(before);
    await approval
      .getByRole('button', {
        name: choice,
        exact: true,
      })
      .click();
    await expect(
      page
        .getByRole('article', {
          name: 'Clef reply',
        })
        .last(),
    ).toContainText('Configuration finished on test-model. Rejected.');
    const after = await settings(page, clef.url);
    expect(after.active.models).toEqual(before.active.models);
    expect(after.active.permissions).toHaveLength(choice === 'Never' ? 1 : 0);
    await clef.restart();
    await page.reload();
    await send(page, 'configure switch again');
    if (choice === 'Never') {
      await expect(
        page
          .getByRole('article', {
            name: 'Clef reply',
          })
          .last(),
      ).toContainText('Configuration finished on test-model. Rejected.');
      expect((await snapshot(page, clef.url)).permissions).toEqual([]);
    } else {
      await expect(approval).toBeVisible();
      await approval
        .getByRole('button', {
          name: 'Deny',
          exact: true,
        })
        .click();
    }
    expect((await settings(page, clef.url)).active.models).toEqual(before.active.models);
  });
}

for (const interruption of [
  'Stop',
  'restart',
]) {
  test(`${interruption} invalidates pending approvals without replaying the change`, async ({
    page,
    clef,
  }) => {
    await clef.setup();
    const before = await settings(page, clef.url);
    await page.goto(clef.url);
    await send(page, 'configure switch');
    await expect(
      page.getByRole('region', {
        name: 'Configuration approval',
      }),
    ).toBeVisible();
    const pending = await snapshot(page, clef.url);
    if (interruption === 'Stop') {
      await page
        .getByRole('button', {
          name: 'Stop reply',
        })
        .click();
    } else {
      await clef.restart();
      await page.reload();
    }
    await expect(
      page.getByRole('region', {
        name: 'Configuration approval',
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: 'Stop reply',
      }),
    ).toHaveCount(0);
    const response = await page.request.post(
      `${clef.url}/api/conversation/permissions/${pending.permissions[0]?.id}`,
      {
        data: {
          choice: 'always',
        },
      },
    );
    expect(response.status()).toBe(409);
    expect(await settings(page, clef.url)).toEqual(before);
    expect((await snapshot(page, clef.url)).conversation.model.modelId).toBe('test-model');
    await send(page, 'Still here');
    await expect(
      page
        .getByRole('article', {
          name: 'Clef reply',
        })
        .last(),
    ).toContainText('Clef heard: Still here');
  });
}

test('rejects a stale approval after an overlapping settings edit', async ({ page, clef }) => {
  await clef.setup();
  await page.goto(clef.url);
  await send(page, 'configure switch');
  await expect(
    page.getByRole('region', {
      name: 'Configuration approval',
    }),
  ).toBeVisible();
  const view = await settings(page, clef.url);
  const update = await page.request.put(`${clef.url}/api/models/default`, {
    data: {
      ...view.active.models.defaults,
      modelId: 'second-model',
      revision: view.revision,
    },
  });
  expect(update.status()).toBe(200);
  const changed = await settings(page, clef.url);
  await page
    .getByRole('button', {
      name: 'This time',
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole('article', {
        name: 'Clef reply',
      })
      .last(),
  ).toContainText('Configuration finished on test-model. Rejected.');
  expect(await settings(page, clef.url)).toEqual(changed);
  expect((await snapshot(page, clef.url)).conversation.model.modelId).toBe('test-model');
});

test('Always persists only the displayed model, conversation and switch scope', async ({
  page,
  clef,
}) => {
  await clef.setup();
  await page.goto(clef.url);
  await send(page, 'configure defaults only');
  await expect(
    page.getByRole('region', {
      name: 'Configuration approval',
    }),
  ).toContainText('Do not switch this reply. Saved defaults apply to your next message.');
  await page
    .getByRole('button', {
      name: 'Always',
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole('article', {
        name: 'Clef reply',
      })
      .last(),
  ).toContainText('Configuration finished on test-model. Applied.');
  await clef.restart();
  await page.reload();
  await send(page, 'configure defaults only again');
  await expect(
    page
      .getByRole('article', {
        name: 'Clef reply',
      })
      .last(),
  ).toContainText('Configuration finished on second-model. Applied.');
  expect((await snapshot(page, clef.url)).permissions).toEqual([]);
  for (const text of [
    'configure original defaults only',
    'configure switch',
  ]) {
    await send(page, text);
    await expect(
      page.getByRole('region', {
        name: 'Configuration approval',
      }),
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: 'Deny',
        exact: true,
      })
      .click();
    await expect(
      page
        .getByRole('article', {
          name: 'Clef reply',
        })
        .last(),
    ).toContainText('Rejected.');
  }
  expect((await settings(page, clef.url)).active.permissions).toHaveLength(1);
});

test('requires approval and switches the persistent conversation at the next model request', async ({
  page,
  clef,
}) => {
  await clef.setup();
  const original = await snapshot(page, clef.url);
  await page.goto(clef.url);
  await expect(page.locator('header')).toContainText('Connected');
  await expect(page.locator('header')).not.toContainText('Loading…');
  await page.getByPlaceholder('Message Clef…').fill('configure switch');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  await expect(
    page.getByRole('region', {
      name: 'Configuration approval',
    }),
  ).toBeVisible();
  expect((await (await page.request.get(`${clef.url}/api/models`)).json()).defaults.modelId).toBe(
    'test-model',
  );
  await page
    .getByRole('button', {
      name: 'This time',
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole('article', {
        name: 'Clef reply',
      })
      .last(),
  ).toContainText('Configuration finished on second-model. Applied.');
  expect((await (await page.request.get(`${clef.url}/api/models`)).json()).defaults.modelId).toBe(
    'second-model',
  );
  expect((await snapshot(page, clef.url)).conversation.id).toBe(original.conversation.id);
  await clef.restart();
  await page.reload();
  await expect(page.locator('header')).toContainText('second-model');
  await send(page, 'configure switch again');
  await expect(
    page.getByRole('region', {
      name: 'Configuration approval',
    }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Deny',
      exact: true,
    })
    .click();
});
