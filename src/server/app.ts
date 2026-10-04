import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Provider } from '@earendil-works/pi-ai';
import staticFiles from '@fastify/static';
import { openAccounts, registerAccountRoutes } from './accounts/index.js';
import { openAgent } from './agent/index.js';
import { openCredentials, registerCredentialRoutes } from './credentials/index.js';
import { registerMessageRoutes } from './messages/index.js';
import { openModels, registerModelRoutes } from './models/index.js';
import { openPermissions } from './permissions/index.js';
import { openInstallation } from './platform/database.js';
import { createHttpServer } from './platform/http.js';

export async function createApp(options: { home: string; providers?: readonly Provider[] }) {
  const installation = await openInstallation(options.home);
  const credentials = await openCredentials(installation.database, installation.keyPath);
  const accounts = await openAccounts(installation.database, (key) =>
    credentials.initializeKey(key),
  );
  const models = await openModels(installation.database, credentials.store, options.providers);
  const permissions = await openPermissions(installation.database);
  const agent = await openAgent(installation.database, models.runtime);

  const server = await createHttpServer();
  const setupToken = randomBytes(32).toString('base64url');

  registerAccountRoutes(server, accounts, credentials, models, setupToken);
  registerCredentialRoutes(server, credentials);
  registerModelRoutes(server, models);
  registerMessageRoutes(server, agent, models, permissions);

  await server.register(staticFiles, {
    root: fileURLToPath(new URL('../../dist', import.meta.url)),
  });

  server.addHook('onClose', async () => {
    permissions.close();
    await models.login.close();
    await credentials.close();
    await agent.close();
    await installation.database.close();
  });

  return {
    server,
    setupToken,
    async entryUrl(url: string) {
      return (await accounts.hasAccount()) ? url : `${url}/#setup=${setupToken}`;
    },
  };
}
