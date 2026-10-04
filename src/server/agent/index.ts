import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Models } from '@earendil-works/pi-ai';
import { createRegistry, Harness } from '@earendil-works/pi-durable';
import type { Database } from '../platform/database.js';
import { AgentRepository } from './repository.js';
import { Agent } from './service.js';

export type { Agent } from './service.js';

export async function openAgent(database: Database, models: Models): Promise<Agent> {
  const repository = await AgentRepository.open(database);
  const harness = await Harness.open(
    repository.storage,
    {
      models,
      registry: createRegistry(),
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
