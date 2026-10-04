import type { Database } from '../platform/database.js';
import { PermissionRepository } from './repository.js';
import { Permissions } from './service.js';

export type { Permissions } from './service.js';

export async function openPermissions(
  database: Database,
  lifetimeMs = 120_000,
): Promise<Permissions> {
  const repository = new PermissionRepository(database);
  await repository.initialize();
  return new Permissions(repository, lifetimeMs);
}
