import type { Agent } from '../agent/index.js';
import type { Credentials } from '../credentials/index.js';
import type { Models } from '../models/index.js';
import type { Database } from '../platform/database.js';
import { TelegramDelivery } from './delivery.js';
import { TelegramRepository } from './repository.js';
import { Telegram } from './service.js';

export { registerTelegramRoutes } from './routes.js';
export type { Telegram } from './service.js';

export async function openTelegram(options: {
  database: Database;
  home: string;
  credentials: Credentials;
  agent: Agent;
  models: Models;
  fetch?: typeof fetch;
}): Promise<Telegram> {
  const repository = new TelegramRepository(options.database, options.home);
  await repository.initialize();
  const delivery = new TelegramDelivery(repository, options.agent, options.models);
  const telegram = new Telegram(repository, options.credentials, options.fetch ?? fetch, delivery);
  telegram.start();
  return telegram;
}
