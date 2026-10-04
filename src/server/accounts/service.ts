import { randomBytes } from 'node:crypto';
import { type AccountInput, accountInputSchema } from './contract.js';
import { createAccount, matchesPassword, sessionHash } from './model.js';
import type { AccountRepository } from './repository.js';

export class Accounts {
  private settingUp = false;
  private readonly sessionListeners = new Map<string, Set<() => void>>();

  constructor(
    private readonly repository: AccountRepository,
    private readonly initializeKey: (key: string) => Promise<void>,
  ) {}

  async hasAccount(): Promise<boolean> {
    return (await this.repository.account()) !== undefined;
  }

  async setup(input: AccountInput): Promise<void> {
    if (this.settingUp) throw new Error('Setup is already in progress.');

    this.settingUp = true;

    try {
      if (await this.hasAccount()) throw new Error('Setup is already complete.');

      const { username, password, key } = accountInputSchema.parse(input);
      const account = await createAccount(username, password);

      await this.initializeKey(key);
      await this.repository.save(account);
    } finally {
      this.settingUp = false;
    }
  }

  async verifyPassword(username: string, password: string): Promise<boolean> {
    const account = await this.repository.account();

    return account !== undefined && matchesPassword(account, username, password);
  }

  async createSession(): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.repository.createSession(sessionHash(token));

    return token;
  }

  async sessionValid(token: string | undefined): Promise<boolean> {
    return token !== undefined && this.repository.sessionValid(sessionHash(token));
  }

  onSessionEnd(token: string, listener: () => void): () => void {
    const hash = sessionHash(token);
    const listeners = this.sessionListeners.get(hash) ?? new Set<() => void>();

    listeners.add(listener);
    this.sessionListeners.set(hash, listeners);

    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.sessionListeners.delete(hash);
    };
  }

  async endSession(token: string): Promise<void> {
    const hash = sessionHash(token);
    await this.repository.endSession(hash);

    for (const listener of this.sessionListeners.get(hash) ?? []) listener();
    this.sessionListeners.delete(hash);
  }
}
