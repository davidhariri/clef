import { randomUUID } from 'node:crypto';
import type { Database } from '../platform/database.js';

export class ModelRepository {
  constructor(private readonly database: Database) {}
  async initialize(): Promise<void> {
    await this.database.exec(
      'CREATE TABLE IF NOT EXISTS clef_models (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
    await this.database.run("DELETE FROM clef_models WHERE key IN ('defaults', 'ollama-url')");
    await this.database.run(
      'INSERT OR IGNORE INTO clef_models(key, value) VALUES (?, ?)',
      'device-id',
      randomUUID(),
    );
  }
  async deviceId(): Promise<string> {
    const row = await this.database.get<{
      value: string;
    }>('SELECT value FROM clef_models WHERE key = ?', 'device-id');
    if (!row) throw new Error('Missing installation identifier');
    return row.value;
  }
}
