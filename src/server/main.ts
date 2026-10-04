import { homedir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';

const home = process.env.CLEF_HOME ?? join(homedir(), '.local', 'share', 'clef');
const port = Number(process.env.CLEF_PORT ?? 3737);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('CLEF_PORT must be a port number.');
const application = await createApp({
  home,
});
const url = await application.server.listen({
  port,
  host: '127.0.0.1',
});
console.info(
  application.needsSetup ? `Set up Clef: ${url}/#setup=${application.setupToken}` : `Clef: ${url}`,
);
console.info(`Data: ${home}`);
for (const signal of [
  'SIGINT',
  'SIGTERM',
] as const) {
  process.once(signal, () => {
    application.server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
