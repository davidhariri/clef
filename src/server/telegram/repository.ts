import { randomUUID } from 'node:crypto';
import { type FileHandle, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Database } from '../platform/database.js';

const configurationSchema = z
  .object({
    credentialId: z.string().uuid(),
    botId: z.number().int().positive(),
    username: z.string().regex(/^[A-Za-z0-9_]+$/),
  })
  .strict();

export type TelegramConfiguration = z.infer<typeof configurationSchema>;

const stateSchema = z.object({
  offset: z.number().int().nonnegative(),
  ownerId: z.number().int().positive().optional(),
  deliveryError: z.string().optional(),
  delivery: z
    .object({
      requestId: z.string().uuid(),
      createdAt: z.number(),
      nextPart: z.number().int().nonnegative(),
      sending: z.boolean(),
      retryAt: z.number().optional(),
      notice: z.string().optional(),
    })
    .optional(),
});

export type TelegramState = z.infer<typeof stateSchema>;

export class TelegramRepository {
  private readonly path: string;

  constructor(
    private readonly database: Database,
    home: string,
  ) {
    this.path = join(home, 'telegram.json');
  }

  async initialize(): Promise<void> {
    await this.database.exec(
      'CREATE TABLE IF NOT EXISTS clef_telegram (id TEXT PRIMARY KEY, state TEXT NOT NULL)',
    );
  }

  async configuration(): Promise<TelegramConfiguration | undefined> {
    let file: FileHandle;
    try {
      file = await open(this.path, 'r');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
    try {
      const buffer = Buffer.alloc(4097);
      const { bytesRead } = await file.read(buffer);
      if (bytesRead > 4096) throw new Error('Telegram configuration is too large.');
      return configurationSchema.parse(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
    } finally {
      await file.close();
    }
  }

  async configure(configuration: TelegramConfiguration): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(configuration, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, {
        force: true,
      });
    }
  }

  async disconnect(): Promise<void> {
    await rm(this.path, {
      force: true,
    });
  }

  async state(id: string): Promise<TelegramState> {
    const row = await this.database.get<{
      state: string;
    }>('SELECT state FROM clef_telegram WHERE id = ?', id);
    return row
      ? stateSchema.parse(JSON.parse(row.state))
      : {
          offset: 0,
        };
  }

  async save(id: string, state: TelegramState): Promise<void> {
    await this.database.run(
      'INSERT INTO clef_telegram (id, state) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state',
      id,
      JSON.stringify(state),
    );
  }

  async remove(id: string): Promise<void> {
    await this.database.run('DELETE FROM clef_telegram WHERE id = ?', id);
  }
}
