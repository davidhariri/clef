import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { Credentials } from '../credentials/index.js';
import { HttpError } from '../platform/http.js';
import { TelegramClient, TelegramError, type TelegramUpdate } from './client.js';
import { type TelegramPairing, type TelegramStatus, telegramInputSchema } from './contract.js';
import type { TelegramConnection, TelegramDelivery } from './delivery.js';
import type { TelegramRepository } from './repository.js';

export class Telegram {
  private connection: TelegramConnection | undefined;
  private pairing:
    | {
        code: string;
        expiresAt: number;
      }
    | undefined;
  private error: string | undefined;
  private configurationError: string | undefined;
  private nextConfigurationAttempt = 0;
  private controller = new AbortController();
  private running: Promise<void> = Promise.resolve();
  private changing = false;

  constructor(
    private readonly repository: TelegramRepository,
    private readonly credentials: Credentials,
    private readonly transport: typeof fetch,
    private readonly delivery: TelegramDelivery,
  ) {}

  start(): void {
    this.controller = new AbortController();
    this.running = this.run(this.controller.signal);
  }

  async status(): Promise<TelegramStatus> {
    return {
      state: this.connection
        ? this.connection.state.ownerId
          ? 'connected'
          : 'pairing'
        : 'disconnected',
      username: this.connection?.configuration.username,
      ownerId: this.connection?.state.ownerId,
      error: this.configurationError ?? this.error ?? this.connection?.state.deliveryError,
    };
  }

  async connect(token: string): Promise<TelegramPairing> {
    if (this.changing)
      throw new HttpError(409, 'A Telegram connection change is already in progress.');
    this.changing = true;
    try {
      await this.close();
      const input = telegramInputSchema.parse({
        token,
      });
      const client = new TelegramClient(input.token, this.transport);
      const identity = await client.identity(AbortSignal.timeout(10_000));
      const configuration = {
        credentialId: randomUUID(),
        botId: identity.id,
        username: identity.username,
      };
      await this.credentials.store.modify(configuration.credentialId, async () => ({
        type: 'api_key',
        key: input.token,
      }));
      try {
        await this.repository.configure(configuration);
      } catch (error) {
        await this.credentials.store.delete(configuration.credentialId);
        throw error;
      }
      const previous = this.connection;
      this.connection = {
        configuration,
        client,
        state: {
          offset: 0,
        },
      };
      this.error = undefined;
      this.configurationError = undefined;
      this.nextConfigurationAttempt = 0;
      if (previous) await this.forget(previous.configuration.credentialId);
      return this.pair();
    } finally {
      this.start();
      this.changing = false;
    }
  }

  pair(): TelegramPairing {
    if (!this.connection) throw new HttpError(409, 'Connect a Telegram bot first.');
    if (this.connection.state.ownerId)
      throw new HttpError(409, 'Disconnect Telegram before pairing another account.');
    this.pairing = {
      code: randomBytes(24).toString('base64url'),
      expiresAt: Date.now() + 600_000,
    };
    return {
      url: `https://t.me/${this.connection.configuration.username}?start=${this.pairing.code}`,
      expiresAt: this.pairing.expiresAt,
    };
  }

  async disconnect(): Promise<void> {
    if (this.changing)
      throw new HttpError(409, 'A Telegram connection change is already in progress.');
    this.changing = true;
    try {
      await this.close();
      await this.repository.disconnect();
      const previous = this.connection;
      this.connection = undefined;
      this.pairing = undefined;
      this.error = undefined;
      this.configurationError = undefined;
      this.nextConfigurationAttempt = 0;
      if (previous) await this.forget(previous.configuration.credentialId);
    } finally {
      this.start();
      this.changing = false;
    }
  }

  private async forget(id: string): Promise<void> {
    await this.credentials.store.delete(id);
    await this.repository.remove(id);
  }

  private async reload(signal: AbortSignal): Promise<void> {
    const configuration = await this.repository.configuration();
    if (!configuration) {
      this.connection = undefined;
      this.pairing = undefined;
      return;
    }
    if (JSON.stringify(configuration) === JSON.stringify(this.connection?.configuration)) return;
    const credential = await this.credentials.store.read(configuration.credentialId);
    if (credential?.type !== 'api_key' || !credential.key)
      throw new Error('Missing Telegram token.');
    const input = telegramInputSchema.parse({
      token: credential.key,
    });
    const client = new TelegramClient(input.token, this.transport);
    const identity = await client.identity(signal);
    if (identity.id !== configuration.botId) throw new Error('Telegram bot identity changed.');
    this.connection = {
      configuration,
      client,
      state: await this.repository.state(configuration.credentialId),
    };
    this.pairing = undefined;
  }

  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.refreshConfiguration(signal);
        signal.throwIfAborted();
        await this.poll(signal);
      } catch (error) {
        if (signal.aborted) break;
        this.error =
          error instanceof TelegramError
            ? error.message
            : 'Telegram could not load its configuration or process a message. Check the connection.';
        await setTimeout(
          error instanceof TelegramError ? error.retryAfter * 1000 : 3000,
          undefined,
          {
            signal,
          },
        ).catch(() => undefined);
      }
    }
  }

  private async refreshConfiguration(signal: AbortSignal): Promise<void> {
    if (Date.now() < this.nextConfigurationAttempt) return;
    try {
      await this.reload(signal);
      this.configurationError = undefined;
    } catch (error) {
      this.nextConfigurationAttempt =
        Date.now() + (error instanceof TelegramError ? error.retryAfter * 1000 : 3000);
      this.configurationError = this.connection
        ? 'Telegram configuration could not be loaded. The last valid connection remains active. Reconnect in Settings to repair it.'
        : 'Telegram is off because its configuration or encrypted token could not be loaded. Restore the installation key or reconnect in Settings.';
    }
  }

  private async poll(signal: AbortSignal): Promise<void> {
    const connection = this.connection;
    if (!connection) {
      await setTimeout(1000, undefined, {
        signal,
      });
      return;
    }
    if (connection.state.delivery) {
      await this.delivery.flush(connection, signal);
      return;
    }
    const updates = await connection.client.updates(connection.state.offset, signal);
    this.error = undefined;
    for (const update of updates) {
      signal.throwIfAborted();
      await this.receive(connection, update, signal);
      if (connection.state.delivery) break;
    }
  }

  private async receive(
    connection: TelegramConnection,
    update: TelegramUpdate,
    signal: AbortSignal,
  ): Promise<void> {
    if (update.update_id < connection.state.offset) return;
    connection.state.offset = update.update_id + 1;
    const message = update.message;
    const privateSender =
      message?.chat.type === 'private' &&
      message.from &&
      !message.from.is_bot &&
      message.from.id === message.chat.id;
    if (privateSender && !connection.state.ownerId && this.matchesPairing(message.text)) {
      connection.state.ownerId = message.from?.id;
      this.pairing = undefined;
      await this.repository.save(connection.configuration.credentialId, connection.state);
      await connection.client.send(
        message.chat.id,
        'Connected to Clef. Send a text message to start. This is the same conversation as your web chat.',
        signal,
      );
      return;
    }
    if (privateSender && message.from?.id === connection.state.ownerId) {
      await this.delivery.accept(connection, message.text);
      return;
    }
    await this.repository.save(connection.configuration.credentialId, connection.state);
  }

  private matchesPairing(text: string | undefined): boolean {
    if (!this.pairing || this.pairing.expiresAt <= Date.now()) return false;
    const supplied = text?.match(/^\/start ([A-Za-z0-9_-]+)$/)?.[1];
    return (
      supplied !== undefined &&
      supplied.length === this.pairing.code.length &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(this.pairing.code))
    );
  }

  async close(): Promise<void> {
    this.controller.abort();
    await this.running;
  }
}
