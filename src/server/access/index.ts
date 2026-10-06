import type { Database } from '../platform/database.js';
import { AccessRepository, localCredential } from './repository.js';
import { Access } from './service.js';

export { registerAccessRoutes } from './routes.js';

export async function openAccess(database: Database, home: string) {
  const repository = new AccessRepository(database);
  await repository.initialize();
  return new Access(repository, await localCredential(home));
}
