import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite';
import { openNodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node';

export type Database = SqliteDatabase;
export type Installation = Awaited<ReturnType<typeof openInstallation>>;

export async function openInstallation(home: string) {
  for (const directory of [
    home,
    join(home, 'state'),
    join(home, 'secrets'),
    join(home, 'workspace'),
  ]) {
    await mkdir(directory, {
      recursive: true,
      mode: 0o700,
    });
    await chmod(directory, 0o700);
  }
  const databasePath = join(home, 'state', 'clef.sqlite');
  const database = await openNodeSqliteDatabase(databasePath);
  await chmod(databasePath, 0o600);
  return {
    home,
    database,
    databasePath,
    keyPath: join(home, 'secrets', 'encryption.key'),
    workspacePath: join(home, 'workspace'),
  };
}
