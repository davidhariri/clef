import type { Database } from '../platform/database.js';
import type { Account } from './model.js';

export class AccountRepository {
  constructor(private readonly database: Database) {}

  async initialize(): Promise<void> {
    await this.database.exec(`
      CREATE TABLE IF NOT EXISTS clef_accounts (id INTEGER PRIMARY KEY CHECK(id = 1), username TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS clef_sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    `);
  }
  account(): Promise<Account | undefined> {
    return this.database.get('SELECT username, salt, hash FROM clef_accounts WHERE id = 1');
  }
  async save(account: Account): Promise<void> {
    await this.database.run(
      'INSERT INTO clef_accounts(id, username, salt, hash) VALUES (1, ?, ?, ?)',
      account.username,
      account.salt,
      account.hash,
    );
  }
  async createSession(hash: string): Promise<void> {
    await this.database.run('DELETE FROM clef_sessions WHERE expires < ?', Date.now());
    await this.database.run(
      'INSERT INTO clef_sessions(hash, expires) VALUES (?, ?)',
      hash,
      Date.now() + 7 * 86400_000,
    );
  }
  async sessionValid(hash: string): Promise<boolean> {
    return Boolean(
      await this.database.get(
        'SELECT hash FROM clef_sessions WHERE hash = ? AND expires > ?',
        hash,
        Date.now(),
      ),
    );
  }
  async endSession(hash: string): Promise<void> {
    await this.database.run('DELETE FROM clef_sessions WHERE hash = ?', hash);
  }
}
