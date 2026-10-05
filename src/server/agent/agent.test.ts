import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openCredentials } from '../credentials/index.js';
import { openFiles } from '../files/index.js';
import { openModels } from '../models/index.js';
import { openPermissions } from '../permissions/index.js';
import { openInstallation } from '../platform/database.js';
import { openAgent } from './index.js';

it('streams one saved reply, deduplicates input, and restores the conversation after restart', async () => {
  const installation = await testInstallation();
  const credentials = await openCredentials(installation.database, installation.keyPath);
  const provider = fauxProvider({
    provider: 'test',
    models: [
      {
        id: 'test-model',
      },
    ],
    tokensPerSecond: 100,
  });
  provider.setResponses([
    (context) => {
      expect(
        context.messages
          .filter((message) => message.role === 'system')
          .flatMap((message) => message.toolsAdded ?? [])
          .map((tool) => tool.name),
      ).toEqual([
        'settings_inspect',
        'settings_change',
        'files_access',
        'files',
      ]);
      return fauxAssistantMessage('Hello from the test model.');
    },
  ]);
  const models = await openModels(installation.database, credentials.store, installation.settings, [
    provider.provider,
  ]);
  await installation.settings.initialize((configuration) =>
    models.validateConfiguration(configuration),
  );
  const permissions = await openPermissions(installation.database, installation.settings);
  const files = openFiles(installation.home, installation.workspacePath, permissions);
  const agent = await openAgent(
    installation.database,
    models,
    installation.settings,
    permissions,
    files,
  );
  const settings = {
    provider: 'test',
    modelId: 'test-model',
    thinkingLevel: 'off',
  } as const;
  try {
    await agent.open(settings);
    const id = crypto.randomUUID();
    await agent.send('Hello', id, settings);
    await agent.send('Hello', id, settings);
    await vi.waitFor(async () => expect((await agent.snapshot()).busy).toBe(false));
    expect((await agent.snapshot()).messages.map((message) => message.text)).toEqual([
      'Hello',
      'Hello from the test model.',
    ]);
    await agent.close();
    const reopened = await openInstallation(installation.home);
    const restored = await openAgent(
      reopened.database,
      models,
      installation.settings,
      permissions,
      files,
    );
    try {
      expect((await restored.snapshot()).messages).toHaveLength(2);
    } finally {
      await restored.close();
      await reopened.database.close();
    }
  } finally {
    await agent.close();
    await credentials.close();
    await installation.dispose();
  }
});
