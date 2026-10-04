import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openCredentials } from '../credentials/index.js';
import { openModels } from '../models/index.js';
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
          .flatMap((message) => message.toolsAdded ?? []),
      ).toEqual([]);
      return fauxAssistantMessage('Hello from the test model.');
    },
  ]);
  const models = await openModels(installation.database, credentials.store, [
    provider.provider,
  ]);
  const agent = await openAgent(installation.database, models.runtime);
  const settings = {
    provider: 'test',
    modelId: 'test-model',
    thinkingLevel: 'off',
  } as const;
  try {
    const conversation = await agent.create(settings);
    const id = crypto.randomUUID();
    await agent.send(conversation.id, 'Hello', id);
    await agent.send(conversation.id, 'Hello', id);
    await vi.waitFor(async () => expect((await agent.snapshot(conversation.id)).busy).toBe(false));
    expect((await agent.snapshot(conversation.id)).messages.map((message) => message.text)).toEqual(
      [
        'Hello',
        'Hello from the test model.',
      ],
    );
    await agent.close();
    const reopened = await openInstallation(installation.home);
    const restored = await openAgent(reopened.database, models.runtime);
    try {
      expect((await restored.snapshot(conversation.id)).messages).toHaveLength(2);
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
