import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../platform/http.js';
import type { AccessRepository } from './repository.js';

export class Access {
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(
    private readonly repository: AccessRepository,
    readonly localToken: string,
  ) {}

  async authenticate(authorization: string | undefined) {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '')?.[1];
    if (!token) throw new HttpError(401, 'Connect with a valid Clef client token.');
    if (timingSafeEqual(Buffer.from(token), Buffer.from(this.localToken))) return 'local';
    const client = await this.repository.find(createHash('sha256').update(token).digest('hex'));
    if (!client) throw new HttpError(401, 'This client token is invalid or revoked.');
    return client.id;
  }

  list() {
    return this.repository.list();
  }

  async issue(name: string) {
    if ((await this.repository.list()).length >= 100)
      throw new HttpError(409, 'Remove a client before adding another.');
    const token = randomBytes(32).toString('base64url');
    const client = {
      id: randomUUID(),
      name,
      createdAt: Date.now(),
    };
    await this.repository.add({
      ...client,
      hash: createHash('sha256').update(token).digest('hex'),
    });
    return {
      ...client,
      token,
    };
  }

  watch(id: string, close: () => void) {
    const listeners = this.listeners.get(id) ?? new Set<() => void>();
    listeners.add(close);
    this.listeners.set(id, listeners);
    return () => {
      listeners.delete(close);
      if (!listeners.size) this.listeners.delete(id);
    };
  }

  async revoke(id: string) {
    await this.repository.remove(id);
    for (const close of this.listeners.get(id) ?? []) close();
    this.listeners.delete(id);
  }
}
