#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { runCli } from './lifecycle/index.js';

try {
  await runCli(fileURLToPath(import.meta.url), async (home, port) => {
    const application = await createApp({
      home,
    });
    try {
      const url = await application.server.listen({
        port,
        host: '127.0.0.1',
      });
      return {
        url: () => application.entryUrl(url),
        close: () => application.server.close(),
      };
    } catch (error) {
      await application.server.close();
      throw error;
    }
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
