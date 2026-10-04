import type { Database } from '../platform/database.js';
import type { Settings } from '../settings/index.js';
import { PermissionRepository } from './repository.js';
import { Permissions } from './service.js';

export type { Permissions } from './service.js';

export async function openPermissions(
  database: Database,
  settings: Settings,
  lifetimeMs = 120_000,
): Promise<Permissions> {
  await PermissionRepository.removeObsoleteTable(database);
  const repository = new PermissionRepository(settings);
  return new Permissions(repository, lifetimeMs);
}
