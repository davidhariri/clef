import type { Database } from '../platform/database.js';
import { AccountRepository } from './repository.js';
import { Accounts } from './service.js';

export { registerAccountRoutes } from './routes.js';
export type { Accounts } from './service.js';

export async function openAccounts(
  database: Database,
  initializeKey: (key: string) => Promise<void>,
): Promise<Accounts> {
  const repository = new AccountRepository(database);
  await repository.initialize();
  return new Accounts(repository, initializeKey);
}
