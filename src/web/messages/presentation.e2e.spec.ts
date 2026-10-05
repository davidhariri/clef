import { expect, test } from '../../../tests/browser.js';

test('renders model-composed controls and returns their values after a refresh', async ({
  page,
  clef,
}) => {
  await clef.setup();
  await page.emulateMedia({
    colorScheme: 'light',
  });
  await page.goto(clef.url);
  await page.getByPlaceholder('Message Clef…').fill('present preferences');
  await page
    .getByRole('button', {
      name: 'Send message',
    })
    .click();
  const card = page.getByRole('region', {
    name: 'Model preferences',
  });
  await expect(card).toBeVisible();
  await expect(card.getByRole('table')).toContainText('Imaginary model');
  await clef.restart();
  await page.reload();
  await expect(card).toBeVisible();
  const other = await page.context().newPage();
  await other.goto(clef.url);
  const otherTopic = other
    .getByRole('region', {
      name: 'Model preferences',
    })
    .getByLabel('Topic', {
      exact: true,
    });
  await otherTopic.fill('Unsubmitted draft');
  await card
    .getByRole('combobox', {
      name: 'Model',
      exact: true,
    })
    .click();
  await page
    .getByRole('option', {
      name: 'Another model',
    })
    .click();
  await card
    .getByLabel('Topic', {
      exact: true,
    })
    .fill('Speed');
  await card
    .getByLabel('Notes', {
      exact: true,
    })
    .fill('Compare local options');
  await card
    .getByRole('checkbox', {
      name: 'Include details',
    })
    .check();
  const light = await card
    .getByLabel('Topic', {
      exact: true,
    })
    .evaluate((element) => getComputedStyle(element).color);
  await page.emulateMedia({
    colorScheme: 'dark',
  });
  await expect
    .poll(() =>
      card
        .getByLabel('Topic', {
          exact: true,
        })
        .evaluate((element) => getComputedStyle(element).color),
    )
    .not.toBe(light);
  await expect(
    card.getByLabel('Topic', {
      exact: true,
    }),
  ).toHaveValue('Speed');
  await card
    .getByRole('button', {
      name: 'Discuss choices',
    })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Answers sent.', {
      exact: true,
    }),
  ).toBeVisible();
  const reply = page
    .getByRole('article', {
      name: 'Clef reply',
    })
    .last();
  await expect(reply).toContainText('ui_submission');
  await expect(reply).toContainText('another');
  await expect(reply).toContainText('Compare local options');
  await expect(otherTopic).toHaveValue('Speed');
  await expect(otherTopic).toBeDisabled();
  await other.close();
  await page.reload();
  await expect(
    card.getByLabel('Topic', {
      exact: true,
    }),
  ).toHaveValue('Speed');
  await expect(
    card.getByRole('button', {
      name: 'Discuss choices',
    }),
  ).toBeDisabled();
  await expect(
    card.getByRole('button', {
      name: 'Skip',
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    card.getByRole('checkbox', {
      name: 'Include details',
    }),
  ).toBeChecked();
  const catalog = await (await page.request.get(`${clef.url}/api/models`)).json();
  expect(catalog.defaults.modelId).toBe('test-model');
});
