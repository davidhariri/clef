import { fauxProvider, type Provider } from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openCredentials } from '../credentials/index.js';
import { openModels } from './index.js';

it('completes browser sign-in through the provider and stores the token outside the public response', async () => {
  const installation = await testInstallation();
  const credentials = await openCredentials(installation.database, installation.keyPath);
  try {
    await credentials.initializeKey('a'.repeat(64));
    const base = fauxProvider({
      provider: 'test',
    }).provider;
    const provider: Provider = {
      ...base,
      auth: {
        oauth: {
          name: 'Test OAuth',
          async login(interaction) {
            interaction.notify({
              type: 'auth_url',
              url: 'https://example.com/login',
            });
            const code = await interaction.prompt({
              type: 'manual_code',
              message: 'Paste the callback URL',
            });
            if (code !== 'accepted') throw new Error('Bad code');
            return {
              type: 'oauth',
              access: 'private-access-token',
              refresh: 'private-refresh-token',
              expires: Date.now() + 3600_000,
            };
          },
          async refresh(value) {
            return value;
          },
          async toAuth(value) {
            return {
              apiKey: value.access,
            };
          },
        },
      },
    };
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
    const login = await models.login.start('test');
    await vi.waitFor(() => expect(models.login.state(login.id).prompt).toBeTruthy());
    models.login.answer(login.id, 'accepted');
    await vi.waitFor(() => expect(models.login.state(login.id).state).toBe('done'));
    expect(JSON.stringify(models.login.state(login.id))).not.toContain('private-access-token');
    expect(await credentials.store.read('test')).toMatchObject({
      access: 'private-access-token',
    });
    await models.login.close();
  } finally {
    await credentials.close();
    await installation.dispose();
  }
});
