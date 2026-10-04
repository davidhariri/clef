import { expect, test } from '../../../tests/browser.js';

test('rejects unauthenticated access, foreign origins, foreign hosts, and reused setup', async ({
  page,
  clef,
}) => {
  expect((await page.request.get(`${clef.url}/api/conversations`)).status()).toBe(401);
  expect(
    (
      await page.request.post(`${clef.url}/api/setup`, {
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(`${clef.url}/api/setup`, {
        headers: {
          'x-clef-setup': 'é'.repeat(43),
        },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.get(`${clef.url}/api/status`, {
        headers: {
          Host: 'attacker.example',
        },
      })
    ).status(),
  ).toBe(403);
  await clef.setup();
  expect(
    (
      await page.request.post(`${clef.url}/api/conversations`, {
        headers: {
          Origin: 'https://attacker.example',
        },
        data: {},
      })
    ).status(),
  ).toBe(403);
  const token = new URLSearchParams(new URL(clef.setupUrl).hash.slice(1)).get('setup') ?? '';
  expect(
    (
      await page.request.post(`${clef.url}/api/setup`, {
        headers: {
          'x-clef-setup': token,
        },
        data: {},
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post(`${clef.url}/api/logout`, {
        data: {},
      })
    ).ok(),
  ).toBe(true);
  expect((await page.request.get(`${clef.url}/api/conversations`)).status()).toBe(401);
});

test('closes an active conversation stream when its session is revoked', async ({ page, clef }) => {
  await clef.setup();
  await page.goto(clef.url);
  await expect(
    page.getByText('Connected', {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (
      await page.request.post(`${clef.url}/api/logout`, {
        data: {},
      })
    ).ok(),
  ).toBe(true);
  await expect(
    page.getByText('Reconnecting…', {
      exact: true,
    }),
  ).toBeVisible();
});

test('rejects malformed JSON and limits repeated password attempts', async ({ page, clef }) => {
  expect(
    (
      await page.request.post(`${clef.url}/api/login`, {
        headers: {
          'Content-Type': 'application/json',
        },
        data: '{',
      })
    ).status(),
  ).toBe(400);
  await clef.setup();
  let last = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    last = (
      await page.request.post(`${clef.url}/api/login`, {
        data: {
          username: 'david',
          password: 'incorrect password',
        },
      })
    ).status();
    expect([
      401,
      429,
    ]).toContain(last);
  }
  expect(last).toBe(429);
});
