import { type CredentialStore, createModels, type Provider } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import type { Database } from '../platform/database.js';
import { ollamaProvider } from './ollama.js';
import { ModelRepository } from './repository.js';
import { Models } from './service.js';

export { registerModelRoutes } from './routes.js';
export type { Models } from './service.js';

export async function openModels(
  database: Database,
  credentials: CredentialStore,
  providers: readonly Provider[] = [
    openaiProvider(),
    anthropicProvider(),
    openrouterProvider(),
  ],
): Promise<Models> {
  const repository = new ModelRepository(database);
  await repository.initialize();
  const runtime = createModels({
    credentials,
    authContext: {
      env: async () => undefined,
      fileExists: async () => false,
    },
  });
  for (const provider of providers) runtime.setProvider(provider);
  runtime.setProvider(ollamaProvider());
  const models = new Models(runtime, repository, credentials);
  await models.restore();

  return models;
}
