import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { Agent } from '../agent/index.js';
import { sendInputSchema } from '../messages/contract.js';
import type { Models } from '../models/index.js';
import { type TelegramClient, TelegramError } from './client.js';
import type { TelegramConfiguration, TelegramRepository, TelegramState } from './repository.js';

export type TelegramConnection = {
  configuration: TelegramConfiguration;
  client: TelegramClient;
  state: TelegramState;
};

function parts(text: string): string[] {
  const bounded =
    text.length > 60_000
      ? `${text.slice(0, 60_000).replace(/[\uD800-\uDBFF]$/u, '')}\nRead the full reply in Clef's web chat.`
      : text || 'The reply contains no text. Open Clef to check the conversation.';
  const result: string[] = [];
  let offset = 0;
  while (offset < bounded.length) {
    let end = Math.min(offset + 4000, bounded.length);
    const last = bounded.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff && end < bounded.length) end -= 1;
    result.push(bounded.slice(offset, end));
    offset = end;
  }
  return result;
}

export class TelegramDelivery {
  constructor(
    private readonly repository: TelegramRepository,
    private readonly agent: Agent,
    private readonly models: Models,
  ) {}

  async accept(connection: TelegramConnection, text: string | undefined): Promise<void> {
    connection.state.delivery = {
      requestId: randomUUID(),
      createdAt: Date.now(),
      nextPart: 0,
      sending: false,
    };
    connection.state.deliveryError = undefined;
    await this.save(connection);
    try {
      await this.submit(connection, text);
    } catch {
      connection.state.delivery.notice =
        'Clef could not accept this message. Check the web chat and model settings, then send it again.';
    }
    await this.save(connection);
  }

  private async submit(connection: TelegramConnection, text: string | undefined): Promise<void> {
    const delivery = connection.state.delivery;
    if (!delivery) return;
    if (text && /^\/start(?: .*)?$/.test(text.trim())) {
      delivery.notice = 'This Telegram account is already connected to Clef.';
    } else if (!text?.trim()) {
      delivery.notice =
        'This connection accepts text only. Voice notes and attachments are not supported yet.';
    } else {
      const input = sendInputSchema.parse({
        text,
        requestId: delivery.requestId,
      });
      const model = await this.models.defaults();
      await this.agent.open(model);
      await this.agent.send(input.text, input.requestId, model);
    }
  }

  private async answer(connection: TelegramConnection): Promise<string | undefined> {
    const delivery = connection.state.delivery;
    if (!delivery) return undefined;
    if (delivery.notice) return delivery.notice;
    const reply = await this.agent.reply(delivery.requestId);
    if (reply.state === 'done') return reply.text;
    if (reply.state === 'missing')
      return 'Clef was interrupted before it accepted this message. Please send it again.';
    if (reply.state === 'unanswered')
      return 'The reply stopped or failed. Check the conversation in Clef.';
    if (Date.now() - delivery.createdAt > 300_000)
      return 'The reply is taking longer than expected. Check the conversation in Clef.';
    return undefined;
  }

  async flush(connection: TelegramConnection, signal: AbortSignal): Promise<void> {
    const delivery = connection.state.delivery;
    if (!delivery || !connection.state.ownerId) return;
    if (delivery.sending) {
      connection.state.deliveryError =
        'Telegram delivery was interrupted or failed. A reply may have arrived. Check the web chat; Clef will not send it again automatically.';
      connection.state.delivery = undefined;
      await this.save(connection);
      return;
    }
    const answer = await this.answer(connection);
    if (answer === undefined || (delivery.retryAt ?? 0) > Date.now()) {
      await setTimeout(100, undefined, {
        signal,
      });
      return;
    }
    for (const [index, part] of parts(answer).entries()) {
      if (index < delivery.nextPart) continue;
      signal.throwIfAborted();
      delivery.sending = true;
      await this.save(connection);
      try {
        await connection.client.send(connection.state.ownerId, part, signal);
      } catch (error) {
        if (error instanceof TelegramError && error.rateLimited) {
          delivery.sending = false;
          delivery.retryAt = Date.now() + error.retryAfter * 1000;
          await this.save(connection);
        }
        throw error;
      }
      delivery.sending = false;
      delivery.nextPart = index + 1;
      await this.save(connection);
    }
    connection.state.delivery = undefined;
    await this.save(connection);
  }

  private save(connection: TelegramConnection): Promise<void> {
    return this.repository.save(connection.configuration.credentialId, connection.state);
  }
}
