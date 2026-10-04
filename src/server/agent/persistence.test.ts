import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import { createRegistry, Harness } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { expect, it } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openInstallation } from '../platform/database.js';
import { openAgent } from './index.js';

it('opens the most recent stored chat and keeps older chat records intact', async () => {
  const installation = await testInstallation();
  const models = createModels();
  const settings = {
    provider: 'test',
    modelId: 'test-model',
    thinkingLevel: 'off',
  } as const;
  const harness = await Harness.open(
    await SqliteStorage.open(installation.database),
    {
      models,
      registry: createRegistry(),
    },
    BACKGROUND_CONTEXT,
  );
  const older = await harness.createConversation(
    {
      ownership: {
        kind: 'ownerless',
      },
      agent: {
        model: settings,
      },
    },
    BACKGROUND_CONTEXT,
  );
  const latest = await harness.createConversation(
    {
      ownership: {
        kind: 'ownerless',
      },
      agent: {
        model: settings,
      },
    },
    BACKGROUND_CONTEXT,
  );
  await harness.close(BACKGROUND_CONTEXT);

  const reopened = await openInstallation(installation.home);
  const agent = await openAgent(reopened.database, models);
  try {
    expect((await agent.open(settings)).id).toBe(String(latest.id));
    expect((await agent.open(settings)).id).toBe(String(latest.id));
  } finally {
    await agent.close();
  }

  const preserved = await openInstallation(installation.home);
  const storage = await SqliteStorage.open(preserved.database);
  try {
    expect(await storage.conversation(older.id, BACKGROUND_CONTEXT)).toEqual({
      id: older.id,
    });
  } finally {
    await storage.close(BACKGROUND_CONTEXT);
    await installation.dispose();
  }
});
