import { expect, it, vi } from 'vitest';
import { testApplication } from '../../../tests/installation.js';
import { snapshotSchema } from './contract.js';

it('returns structured form answers to the model exactly once and restores the submitted card', async () => {
  const clef = await testApplication();
  const snapshot = async () =>
    snapshotSchema.parse(
      (
        await clef.server.inject({
          url: '/api/conversation',
          headers: clef.headers,
        })
      ).json(),
    );
  try {
    await clef.server.inject({
      method: 'POST',
      url: '/api/conversation/messages',
      headers: clef.headers,
      payload: {
        text: 'present preferences',
        requestId: crypto.randomUUID(),
      },
    });
    await vi.waitFor(async () => expect((await snapshot()).busy).toBe(false), {
      timeout: 10000,
    });
    const card = (await snapshot()).messages.find((message) => message.ui);
    expect(card).toBeDefined();
    const payload = {
      messageId: card?.id,
      intent: 'discuss',
      values: {
        model: 'imaginary',
        topic: 'Speed',
        notes: 'Compare options',
        detail: true,
      },
    };
    const submit = () =>
      clef.server.inject({
        method: 'POST',
        url: '/api/conversation/messages',
        headers: clef.headers,
        payload: {
          ui: payload,
        },
      });
    expect((await submit()).statusCode).toBe(200);
    await vi.waitFor(async () => expect((await snapshot()).busy).toBe(false), {
      timeout: 5000,
    });
    expect(
      JSON.parse((await snapshot()).messages.at(-1)?.text.replace('Clef heard: ', '') ?? '{}'),
    ).toEqual({
      type: 'ui_submission',
      submission: payload,
    });
    expect((await submit()).statusCode).toBe(200);
    const changed = await clef.server.inject({
      method: 'POST',
      url: '/api/conversation/messages',
      headers: clef.headers,
      payload: {
        ui: {
          ...payload,
          intent: 'skip',
        },
      },
    });
    expect(changed.statusCode).toBe(409);
    const submitted = await snapshot();
    expect(submitted.messages.filter((message) => message.role === 'user')).toHaveLength(2);
    expect(submitted.messages.find((message) => message.ui)?.ui).toMatchObject({
      submitted: true,
      answer: {
        intent: 'discuss',
        values: payload.values,
      },
    });
    await clef.restart();
    expect((await snapshot()).messages).toEqual(submitted.messages);
    expect((await submit()).statusCode).toBe(200);
    expect((await snapshot()).messages).toEqual(submitted.messages);
  } finally {
    await clef.dispose();
  }
});

it('rejects unauthorized, oversized, unknown, and busy submissions without running the model', async () => {
  const clef = await testApplication();
  const snapshot = async () =>
    snapshotSchema.parse(
      (
        await clef.server.inject({
          url: '/api/conversation',
          headers: clef.headers,
        })
      ).json(),
    );
  try {
    await clef.server.inject({
      method: 'POST',
      url: '/api/conversation/messages',
      headers: clef.headers,
      payload: {
        text: 'present preferences',
        requestId: crypto.randomUUID(),
      },
    });
    await vi.waitFor(async () => expect((await snapshot()).busy).toBe(false), {
      timeout: 10000,
    });
    const before = await snapshot();
    const payload = {
      messageId: before.messages.find((message) => message.ui)?.id,
      intent: 'skip',
      values: {
        model: 'imaginary',
        topic: '',
        notes: '',
        detail: false,
      },
    };
    for (const [headers, status] of [
      [
        {
          host: clef.headers.host,
        },
        401,
      ],
      [
        {
          ...clef.headers,
          origin: 'https://untrusted.example',
        },
        403,
      ],
    ] as const) {
      expect(
        (
          await clef.server.inject({
            method: 'POST',
            url: '/api/conversation/messages',
            headers,
            payload: {
              ui: payload,
            },
          })
        ).statusCode,
      ).toBe(status);
    }
    for (const [input, status] of [
      [
        {
          ...payload,
          messageId: 'not-a-message',
        },
        409,
      ],
      [
        {
          ...payload,
          intent: 'execute_settings',
        },
        400,
      ],
      [
        {
          ...payload,
          values: {
            ...payload.values,
            extra: 'not part of this form',
          },
        },
        400,
      ],
      [
        {
          ...payload,
          values: {
            ...payload.values,
            detail: 'not boolean',
          },
        },
        400,
      ],
      [
        {
          ...payload,
          values: {
            ...payload.values,
            topic: 'x'.repeat(70000),
          },
        },
        413,
      ],
    ] as const) {
      expect(
        (
          await clef.server.inject({
            method: 'POST',
            url: '/api/conversation/messages',
            headers: clef.headers,
            payload: {
              ui: input,
            },
          })
        ).statusCode,
      ).toBe(status);
    }
    expect(await snapshot()).toEqual(before);
    await clef.server.inject({
      method: 'POST',
      url: '/api/conversation/messages',
      headers: clef.headers,
      payload: {
        text: 'slow',
        requestId: crypto.randomUUID(),
      },
    });
    expect(
      (
        await clef.server.inject({
          method: 'POST',
          url: '/api/conversation/messages',
          headers: clef.headers,
          payload: {
            ui: payload,
          },
        })
      ).statusCode,
    ).toBe(409);
    expect((await snapshot()).messages.find((message) => message.ui)?.ui?.submitted).toBe(false);
  } finally {
    await clef.dispose();
  }
});
