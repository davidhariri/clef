import { expect, test } from '../../../tests/api.js';

test('revokes an active remote stream and rejects all later requests from that client', async ({
  clef,
}) => {
  await clef.connect();
  const issued = await (
    await clef.request.post('/api/access/clients', {
      data: {
        name: 'Other terminal',
      },
    })
  ).json();
  const abort = new AbortController();
  try {
    const response = await fetch(`${clef.url}/api/conversation/events`, {
      headers: {
        authorization: `Bearer ${issued.token}`,
      },
      signal: abort.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing stream.');
    expect((await reader.read()).done).toBe(false);
    let closed = false;
    const consuming = (async () => {
      try {
        while (!(await reader.read()).done) {}
      } catch {
        closed = true;
      }
      closed = true;
    })();
    expect((await clef.request.delete(`/api/access/clients/${issued.id}`)).ok()).toBe(true);
    await expect.poll(() => closed).toBe(true);
    await consuming;
    expect(
      (
        await fetch(`${clef.url}/api/status`, {
          headers: {
            authorization: `Bearer ${issued.token}`,
          },
        })
      ).status,
    ).toBe(401);
  } finally {
    abort.abort();
  }
});

test('rejects malformed JSON and browser requests without disclosing server credentials', async ({
  clef,
}) => {
  const invalid = await clef.request.post('/api/models/key', {
    headers: {
      'Content-Type': 'application/json',
    },
    data: '{',
  });
  expect(invalid.status()).toBe(400);
  const browser = await clef.request.get('/api/status', {
    headers: {
      origin: clef.url,
    },
  });
  expect(browser.status()).toBe(403);
  expect(JSON.stringify(await browser.json())).not.toContain(clef.token);
  expect(
    (
      await clef.request.post('/api/setup', {
        data: {},
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await clef.request.post('/api/login', {
        data: {},
      })
    ).status(),
  ).toBe(404);
});
