import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createRegistry, Harness } from '@earendil-works/pi-durable';
import type { Models } from '../models/index.js';
import type { Permissions } from '../permissions/index.js';
import type { Database } from '../platform/database.js';
import type { Settings } from '../settings/index.js';
import { configurationTools } from './configuration.js';
import { AgentRepository } from './repository.js';
import { Agent } from './service.js';

export type { Agent } from './service.js';

export async function openAgent(
  database: Database,
  models: Models,
  settings: Settings,
  permissions: Permissions,
): Promise<Agent> {
  const registry = createRegistry();
  registry.install(configurationTools(settings, models, permissions));
  const repository = await AgentRepository.open(database);
  const harness = await Harness.open(
    repository.storage,
    {
      models: models.runtime,
      registry,
      settings: {
        retry: {
          enabled: false,
        },
        stream: {
          timeoutMs: 120_000,
          maxRetries: 0,
        },
      },
    },
    BACKGROUND_CONTEXT,
  );
  const agent = new Agent(harness, repository);
  await agent.restore();
  return agent;
}
