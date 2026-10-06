import { setTimeout as delay } from 'node:timers/promises';
import { createParser } from 'eventsource-parser';
import { z } from 'zod';
import { type ConversationSnapshot, snapshotSchema } from '../server/messages/contract.js';
import { permissionRequestSchema } from '../server/permissions/contract.js';

const limit = 4 * 1024 * 1024;
const permissionUpdateSchema = z.object({
  permissions: permissionRequestSchema.array(),
});

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function serverAddress(value: string): string {
  const url = new URL(value);
  const loopback = [
    '127.0.0.1',
    'localhost',
    '[::1]',
  ].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Use a server origin without a path, credentials, query, or fragment.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new Error(
      'Remote connections require HTTPS. Use Tailscale Serve or a loopback SSH tunnel.',
    );
  return url.origin;
}

async function responseData(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('The server returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error('The server response exceeds 4 MiB.');
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel();
  }
}

export class ClefClient {
  readonly url: string;
  private readonly stop = new AbortController();

  constructor(
    url: string,
    private readonly token: string,
  ) {
    this.url = serverAddress(url);
  }

  close() {
    this.stop.abort();
  }

  private fetch(path: string, init: RequestInit) {
    if (!path.startsWith('/api/')) throw new Error('Use a Clef API path.');
    return fetch(`${this.url}${path}`, {
      ...init,
      redirect: 'error',
      headers: {
        ...(init.body === undefined
          ? {}
          : {
              'Content-Type': 'application/json',
            }),
        authorization: `Bearer ${this.token}`,
      },
    });
  }

  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.fetch(path, {
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
          }),
      signal: AbortSignal.any([
        AbortSignal.timeout(20000),
        this.stop.signal,
        ...(signal
          ? [
              signal,
            ]
          : []),
      ]),
    });
    const data = await responseData(response);
    if (!response.ok) {
      const error = z
        .object({
          error: z.string(),
        })
        .safeParse(data);
      throw new ApiError(response.status, error.success ? error.data.error : 'The request failed.');
    }
    return schema.parse(data);
  }

  async watch(
    signal: AbortSignal,
    update: (snapshot: ConversationSnapshot) => void,
    connection: (error?: Error) => void,
    conversationId?: string,
  ): Promise<void> {
    signal = AbortSignal.any([
      signal,
      this.stop.signal,
    ]);
    while (!signal.aborted) {
      try {
        await this.stream(signal, update, connection, conversationId);
      } catch (error) {
        if (signal.aborted) return;
        const failure = error instanceof Error ? error : new Error('Connection lost.');
        connection(failure);
        if (
          failure instanceof ApiError &&
          [
            401,
            403,
            423,
          ].includes(failure.status)
        )
          return;
      }
      await delay(1000, undefined, {
        signal,
      }).catch(() => undefined);
    }
  }

  private async stream(
    signal: AbortSignal,
    update: (snapshot: ConversationSnapshot) => void,
    connection: (error?: Error) => void,
    conversationId?: string,
  ) {
    const timeout = new AbortController();
    let timer = setTimeout(() => timeout.abort(), 75000);
    const combined = AbortSignal.any([
      signal,
      timeout.signal,
    ]);
    try {
      const path = `/api/conversation/events${conversationId ? `?id=${encodeURIComponent(conversationId)}` : ''}`;
      const response = await this.fetch(path, {
        signal: combined,
      });
      if (!response.ok)
        throw new ApiError(
          response.status,
          `Connection rejected (${response.status}). Reconnect to the server.`,
        );
      if (!response.body) throw new Error('No conversation stream.');
      connection();
      let snapshot: ConversationSnapshot | undefined;
      let buffered = 0;
      const parser = createParser({
        onEvent: (event) => {
          buffered = 0;
          if (event.event === 'snapshot') snapshot = snapshotSchema.parse(JSON.parse(event.data));
          if (event.event === 'permissions' && snapshot)
            snapshot = {
              ...snapshot,
              ...permissionUpdateSchema.parse(JSON.parse(event.data)),
            };
          if (snapshot) update(snapshot);
        },
      });
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        clearTimeout(timer);
        timer = setTimeout(() => timeout.abort(), 75000);
        buffered += chunk.byteLength;
        if (buffered > limit) throw new Error('The conversation update exceeds 4 MiB.');
        parser.feed(
          decoder.decode(chunk, {
            stream: true,
          }),
        );
      }
    } finally {
      clearTimeout(timer);
      timeout.abort();
    }
  }
}
