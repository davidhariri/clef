import type { Credential } from '@earendil-works/pi-ai';
import type { Database } from '../platform/database.js';

export class CredentialRepository {
  constructor(private readonly database: Database) {}

  async initialize(): Promise<void> {
    await this.database.exec(`
      CREATE TABLE IF NOT EXISTS clef_key_check (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS clef_credentials (provider TEXT PRIMARY KEY, type TEXT NOT NULL, value TEXT NOT NULL);
    `);
  }
  async keyCheck(): Promise<string | undefined> {
    return (
      await this.database.get<{
        value: string;
      }>('SELECT value FROM clef_key_check WHERE id = 1')
    )?.value;
  }
  async saveKeyCheck(value: string): Promise<void> {
    await this.database.run('INSERT INTO clef_key_check(id, value) VALUES (1, ?)', value);
  }
  async read(provider: string): Promise<string | undefined> {
    return (
      await this.database.get<{
        value: string;
      }>('SELECT value FROM clef_credentials WHERE provider = ?', provider)
    )?.value;
  }
  list(): Promise<
    {
      providerId: string;
      type: Credential['type'];
    }[]
  > {
    return this.database.all(
      'SELECT provider AS providerId, type FROM clef_credentials ORDER BY provider',
    );
  }
  async save(provider: string, type: Credential['type'], value: string): Promise<void> {
    await this.database.run(
      'INSERT INTO clef_credentials(provider, type, value) VALUES (?, ?, ?) ON CONFLICT(provider) DO UPDATE SET type = excluded.type, value = excluded.value',
      provider,
      type,
      value,
    );
  }
  async delete(provider: string): Promise<void> {
    await this.database.run('DELETE FROM clef_credentials WHERE provider = ?', provider);
  }
}
