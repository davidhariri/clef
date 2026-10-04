import { fauxProvider } from '@earendil-works/pi-ai';
import { expect, it } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openCredentials } from '../credentials/index.js';
import { openModels } from './index.js';

it('keeps explicit model settings across restart without changing providers', async () => {
  const installation = await testInstallation();
  const credentials = await openCredentials(installation.database, installation.keyPath);
  try {
    await credentials.initializeKey('a'.repeat(64));
    const provider = fauxProvider({
      provider: 'test',
      models: [
        {
          id: 'test-model',
        },
      ],
    }).provider;
    const models = await openModels(
      installation.database,
      credentials.store,
      installation.settings,
      [
        provider,
      ],
    );
    await installation.settings.initialize((configuration) =>
      models.validateConfiguration(configuration),
    );
    await models.saveDefaults({
      provider: 'test',
      modelId: 'test-model',
      thinkingLevel: 'off',
    });
    const reopened = await openModels(
      installation.database,
      credentials.store,
      installation.settings,
      [
        provider,
      ],
    );
    expect((await reopened.catalog()).defaults).toEqual({
      provider: 'test',
      modelId: 'test-model',
      thinkingLevel: 'off',
    });
    await expect(
      models.saveDefaults({
        provider: 'other',
        modelId: 'test-model',
        thinkingLevel: 'off',
      }),
    ).rejects.toThrow();
  } finally {
    await credentials.close();
    await installation.dispose();
  }
});
