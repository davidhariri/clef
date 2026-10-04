import { z } from 'zod';

const updateSchema = z.object({
  update_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  message: z
    .object({
      message_id: z.number().int(),
      from: z
        .object({
          id: z.number().int(),
          is_bot: z.boolean(),
        })
        .optional(),
      chat: z.object({
        id: z.number().int(),
        type: z.string(),
      }),
      text: z.string().optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof updateSchema>;

const envelopeSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error_code: z.number().optional(),
  parameters: z
    .object({
      retry_after: z.number().int().min(1).max(86400).optional(),
    })
    .optional(),
});

export class TelegramError extends Error {
  constructor(
    readonly retryAfter: number,
    message: string,
    readonly rateLimited = false,
  ) {
    super(message);
  }
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Telegram returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 512 * 1024) throw new Error('Telegram returned too much data.');
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly transport: typeof fetch,
  ) {}

  private async call(method: string, body: Record<string, unknown>, signal: AbortSignal) {
    try {
      const response = await this.transport(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(35_000),
        ]),
      });
      const envelope = envelopeSchema.parse(await readResponse(response));
      if (!response.ok || !envelope.ok) {
        const message =
          envelope.error_code === 409
            ? 'Another connection is using this bot. Stop it before connecting Clef.'
            : 'Telegram rejected the request. Check the bot token and connection.';
        throw new TelegramError(
          envelope.parameters?.retry_after ?? 3,
          message,
          envelope.error_code === 429,
        );
      }
      return envelope.result;
    } catch (error) {
      if (error instanceof TelegramError) throw error;
      throw new TelegramError(3, 'Cannot reach Telegram or read its response.');
    }
  }

  async identity(signal: AbortSignal) {
    const bot = z
      .object({
        id: z.number().int().positive(),
        is_bot: z.literal(true),
        username: z.string().regex(/^[A-Za-z0-9_]+$/),
      })
      .parse(await this.call('getMe', {}, signal));
    const webhook = z
      .object({
        url: z.string(),
      })
      .parse(await this.call('getWebhookInfo', {}, signal));
    if (webhook.url)
      throw new TelegramError(3, 'This bot has a webhook. Use a separate bot for Clef.');
    return bot;
  }

  async updates(offset: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    return z
      .array(updateSchema)
      .max(20)
      .parse(
        await this.call(
          'getUpdates',
          {
            offset,
            timeout: 25,
            limit: 20,
            allowed_updates: [
              'message',
            ],
          },
          signal,
        ),
      );
  }

  async send(chatId: number, text: string, signal: AbortSignal): Promise<void> {
    await this.call(
      'sendMessage',
      {
        chat_id: chatId,
        text,
        link_preview_options: {
          is_disabled: true,
        },
      },
      signal,
    );
  }
}
