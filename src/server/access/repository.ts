import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '../platform/database.js';

type Client = {
  id: string;
  name: string;
  createdAt: number;
  hash: string;
};

export class AccessRepository {
  constructor(private readonly database: Database) {}

  async initialize() {
    await this.database.exec(`
      DROP TABLE IF EXISTS clef_sessions;
      DROP TABLE IF EXISTS clef_accounts;
      CREATE TABLE IF NOT EXISTS clef_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt INTEGER NOT NULL, hash TEXT UNIQUE NOT NULL);
    `);
  }

  async add(client: Client) {
    await this.database.run(
      'INSERT INTO clef_clients (id, name, createdAt, hash) VALUES (?, ?, ?, ?)',
      client.id,
      client.name,
      client.createdAt,
      client.hash,
    );
  }

  list(): Promise<Omit<Client, 'hash'>[]> {
    return this.database.all('SELECT id, name, createdAt FROM clef_clients ORDER BY createdAt');
  }

  find(hash: string): Promise<Client | undefined> {
    return this.database.get(
      'SELECT id, name, createdAt, hash FROM clef_clients WHERE hash = ?',
      hash,
    );
  }

  async remove(id: string) {
    await this.database.run('DELETE FROM clef_clients WHERE id = ?', id);
  }
}

export async function localCredential(home: string): Promise<string> {
  const path = join(home, 'secrets', 'local-token');
  try {
    const file = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(randomBytes(32).toString('base64url'));
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const status = await file.stat();
    if (!status.isFile() || status.size !== 43 || (status.mode & 0o077) !== 0)
      throw new Error('The local access credential must be a private regular file.');
    const token = await file.readFile('utf8');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid local access credential.');
    return token;
  } finally {
    await file.close();
  }
}
