import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import type { Credential, CredentialStore } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { decrypt, encrypt, parseKey } from './crypto.js';
import type { CredentialRepository } from './repository.js';

const credentialSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('api_key'),
      key: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
    }),
    z
      .object({
        type: z.literal('oauth'),
        access: z.string(),
        refresh: z.string(),
        expires: z.number(),
      })
      .passthrough(),
  ])
  .transform((value): Credential => {
    if (value.type === 'oauth') return value;
    const credential: Credential = {
      type: 'api_key',
    };
    if (value.key !== undefined) credential.key = value.key;
    if (value.env !== undefined) credential.env = value.env;
    return credential;
  });

export class Credentials {
  private key: Buffer | undefined;
  private readonly writes = new Map<string, Promise<Credential | undefined>>();
  readonly store: CredentialStore;

  constructor(
    private readonly repository: CredentialRepository,
    private readonly keyPath: string,
  ) {
    this.store = {
      read: async (id, options) => {
        options?.signal?.throwIfAborted();
        const value = await repository.read(id);
        if (value === undefined) return undefined;
        try {
          return credentialSchema.parse(JSON.parse(decrypt(this.requireKey(), value, id)));
        } catch {
          throw new Error(
            'Stored credentials cannot be read. Restore the installation key or reconnect the provider.',
          );
        }
      },
      list: async () => repository.list(),
      modify: (id, change, options) => {
        const update = async () => {
          options?.signal?.throwIfAborted();
          const current = await this.store.read(id, options);
          const next = await change(current);
          options?.signal?.throwIfAborted();
          if (next !== undefined) {
            const credential = credentialSchema.parse(next);
            await repository.save(
              id,
              credential.type,
              encrypt(this.requireKey(), JSON.stringify(credential), id),
            );
          }
          return next ?? current;
        };
        const task = (this.writes.get(id) ?? Promise.resolve()).then(update, update);
        this.writes.set(id, task);
        return task;
      },
      delete: (id, options) => {
        const remove = async () => {
          options?.signal?.throwIfAborted();
          await repository.delete(id);
          return undefined;
        };
        const task = (this.writes.get(id) ?? Promise.resolve()).then(remove, remove);
        this.writes.set(id, task);
        return task;
      },
    };
  }

  get locked(): boolean {
    return this.key === undefined;
  }

  async load(): Promise<void> {
    const check = await this.repository.keyCheck();
    try {
      const key = parseKey((await readFile(this.keyPath, 'utf8')).trim());
      if (check && decrypt(key, check, 'installation') !== 'clef') throw new Error('Incorrect key');
      await chmod(this.keyPath, 0o600);
      this.key = key;
    } catch (error) {
      if (check) return;
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw new Error('The installation key cannot be read. Restore the key file.');
    }
  }

  async provision(): Promise<void> {
    if (await this.repository.keyCheck()) return;
    await this.initializeKey(this.key?.toString('hex') ?? randomBytes(32).toString('hex'));
  }

  async initializeKey(keyText: string): Promise<void> {
    const key = parseKey(keyText);
    const check = await this.repository.keyCheck();
    if (check) {
      if (decrypt(key, check, 'installation') !== 'clef') throw new Error('Incorrect key');
      if (!this.key) await this.recover(keyText);
      return;
    }
    if (this.key && !timingSafeEqual(this.key, key))
      throw new Error('An unfinished setup has a saved key. Reuse that key.');
    if (!this.key)
      await writeFile(this.keyPath, keyText, {
        mode: 0o600,
        flag: 'wx',
      });
    await this.repository.saveKeyCheck(encrypt(key, 'clef', 'installation'));
    this.key = key;
  }

  async recover(keyText: string): Promise<void> {
    const key = parseKey(keyText);
    const check = await this.repository.keyCheck();
    if (!check || decrypt(key, check, 'installation') !== 'clef')
      throw new Error('This key does not unlock this installation.');
    await writeFile(this.keyPath, keyText, {
      mode: 0o600,
    });
    await chmod(this.keyPath, 0o600);
    this.key?.fill(0);
    this.key = key;
  }

  private requireKey(): Buffer {
    if (!this.key) throw new Error('Restore the installation key to unlock stored credentials.');
    return this.key;
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.writes.values());
    this.key?.fill(0);
    this.key = undefined;
  }
}
