import { EventSource } from 'eventsource';
import type { z } from 'zod';
import { type ConversationSnapshot, snapshotSchema } from '../../server/messages/contract.js';
import { type RequestOptions, request } from '../api.js';

export class Connection {
  private cookie = '';
  private events: EventSource | undefined;

  constructor(readonly url: string) {
    const parsed = URL.parse(url);
    if (
      !parsed ||
      ![
        '127.0.0.1',
        'localhost',
      ].includes(parsed.hostname) ||
      parsed.protocol !== 'http:' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/'
    )
      throw new Error('This build connects only to a local Clef server.');
  }

  call<T>(path: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
    return request(new URL(path, this.url).href, schema, {
      ...options,
      headers: {
        ...options.headers,
        Cookie: this.cookie,
      },
      onResponse: (response) => {
        const cookies = response.headers.getSetCookie();
        if (cookies.length) this.cookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
      },
    });
  }

  watch(id: string, update: (value: ConversationSnapshot) => void, disconnected: () => void): void {
    this.events?.close();
    const events = new EventSource(
      new URL(`/api/conversations/${encodeURIComponent(id)}/events`, this.url),
      {
        fetch: (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set('Cookie', this.cookie);
          return fetch(url, {
            ...init,
            headers,
          });
        },
      },
    );
    events.addEventListener('snapshot', (event) => {
      try {
        update(snapshotSchema.parse(JSON.parse(event.data)));
      } catch {
        events.close();
        disconnected();
      }
    });
    events.onerror = disconnected;
    this.events = events;
  }

  close(): void {
    this.events?.close();
    this.cookie = '';
  }
}
