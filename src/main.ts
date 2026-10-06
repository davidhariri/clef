#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { ProcessTerminal, type Terminal } from '@earendil-works/pi-tui';
import { ClefClient } from './client/index.js';
import { runCli } from './server/lifecycle/index.js';
import { startServer } from './server/main.js';
import { connectRemote, runTui } from './tui/index.js';

async function terminalSession(run: (terminal: Terminal, signal: AbortSignal) => Promise<void>) {
  const stop = new AbortController();
  const interrupt = () => stop.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  process.once('SIGHUP', interrupt);

  try {
    await run(new ProcessTerminal(), stop.signal);
  } catch (error) {
    if (!stop.signal.aborted) throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('SIGHUP', interrupt);
  }
}

async function main() {
  if (process.argv[2] === '--server') {
    const address = process.argv[3];
    if (process.argv.length !== 4 || !address) throw new Error('Usage: clef --server <https-url>');
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error('Chat needs an interactive terminal.');

    await terminalSession(async (terminal, signal) => {
      const client = await connectRemote(address, terminal, signal);
      if (client) await runTui(client, terminal, signal);
    });
    return;
  }

  await runCli(fileURLToPath(import.meta.url), startServer, (ready) =>
    terminalSession((terminal, signal) =>
      runTui(new ClefClient(ready.url, ready.token), terminal, signal),
    ),
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Clef could not start.');
  process.exitCode = 1;
}
