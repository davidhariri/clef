import type { Database } from '../platform/database.js';
import { CredentialRepository } from './repository.js';
import { Credentials as CredentialService } from './service.js';

export { registerCredentialRoutes } from './routes.js';

export type Credentials = Pick<
  CredentialService,
  'store' | 'locked' | 'initializeKey' | 'provision' | 'recover' | 'close'
>;

export async function openCredentials(database: Database, keyPath: string): Promise<Credentials> {
  const repository = new CredentialRepository(database);
  await repository.initialize();
  const credentials = new CredentialService(repository, keyPath);
  await credentials.load();
  return credentials;
}
