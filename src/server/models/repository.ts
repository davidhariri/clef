import { randomUUID } from 'node:crypto';
import type { Database } from '../platform/database.js';
import { type ModelSettings, modelSettingsSchema } from './contract.js';

export class ModelRepository {
  constructor(private readonly database: Database) {}
  async initialize(): Promise<void> {
    await this.database.exec(
      'CREATE TABLE IF NOT EXISTS clef_models (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
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
  async defaults(): Promise<ModelSettings | null> {
    const row = await this.database.get<{
      value: string;
    }>('SELECT value FROM clef_models WHERE key = ?', 'defaults');
    if (!row) return null;
    try {
      return modelSettingsSchema.parse(JSON.parse(row.value));
    } catch {
      throw new Error('Stored model settings are invalid.');
    }
  }
  async saveDefaults(settings: ModelSettings): Promise<void> {
    await this.database.run(
      'INSERT INTO clef_models(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'defaults',
      JSON.stringify(settings),
    );
  }
}
