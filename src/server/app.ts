import type { Provider } from '@earendil-works/pi-ai';
import { openAccess, registerAccessRoutes } from './access/index.js';
import { openAgent } from './agent/index.js';
import { openCredentials, registerCredentialRoutes } from './credentials/index.js';
import { registerMessageRoutes } from './messages/index.js';
import { openModels, registerModelRoutes } from './models/index.js';
import { openPermissions } from './permissions/index.js';
import { openInstallation } from './platform/database.js';
import { createHttpServer } from './platform/http.js';
import { registerSettingsRoutes, Settings } from './settings/index.js';

export async function createApp(options: { home: string; providers?: readonly Provider[] }) {
  const installation = await openInstallation(options.home);
  const credentials = await openCredentials(installation.database, installation.keyPath);
  await credentials.provision();
  const access = await openAccess(installation.database, options.home);
  const settings = new Settings(options.home);
  const models = await openModels(
    installation.database,
    credentials.store,
    settings,
    options.providers,
  );
  await settings.initialize((configuration) => models.validateConfiguration(configuration));
  const permissions = await openPermissions(installation.database, settings);
  const agent = await openAgent(installation.database, models, settings, permissions);

  const server = await createHttpServer();

  registerAccessRoutes(server, access, credentials, models);
  registerCredentialRoutes(server, credentials);
  registerModelRoutes(server, models);
  registerSettingsRoutes(server, settings);
  registerMessageRoutes(server, agent, models, permissions);

  server.addHook('onClose', async () => {
    permissions.close();
    await models.login.close();
    await credentials.close();
    await agent.close();
    await installation.database.close();
  });

  return {
    server,
    localToken: access.localToken,
  };
}
