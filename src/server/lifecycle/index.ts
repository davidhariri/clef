import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { lock, type Runtime, readRuntime, writeRuntime } from './repository.js';
import {
  checkPort,
  printReady,
  type Ready,
  readiness,
  type StartServer,
  serve,
} from './runtime.js';
import { privateHome } from './storage.js';
import { supervisor } from './supervisor.js';

async function waitReady(home: string, manager: ReturnType<typeof supervisor>, port: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await readiness(home);
    const state = await manager.inspect();
    if (ready?.managed && ready.pid === state.pid && new URL(ready.url).port === String(port))
      return ready;
    await delay(100);
  }
  throw new Error(`Clef did not become ready. Inspect the service and ${manager.log}.`);
}

function verifyReady(ready: Ready, runtime: Runtime) {
  if (new URL(ready.url).port !== String(runtime.port))
    throw new Error(
      'CLEF_PORT conflicts with the running installation. Stop it before changing the port.',
    );
}

async function startManaged(
  home: string,
  runtime: Runtime,
  manager: ReturnType<typeof supervisor>,
  loaded: boolean,
  ready: Ready | undefined,
) {
  if (ready) {
    verifyReady(ready, runtime);
    return ready;
  }
  if (loaded) throw new Error('Clef is registered but not ready. Run clef stop, then clef.');
  const releaseOwner = await lock(home, 'owner');
  releaseOwner();
  await checkPort(runtime.port);
  await writeRuntime(home, runtime);
  try {
    await manager.start(runtime);
    return await waitReady(home, manager, runtime.port);
  } catch (error) {
    await manager.verify(runtime);
    await manager.stop();
    throw error;
  }
}

function printStatus(ready: Ready | undefined, loaded: boolean) {
  if (ready) console.info(`Clef running (PID ${ready.pid}).`);
  else if (loaded) {
    console.info('Clef is not ready.');
    process.exitCode = 1;
  } else console.info('Clef stopped.');
}

async function managed(command: string, home: string, runtime: Runtime) {
  const manager = supervisor(home);
  await manager.available();
  const release = await lock(home, 'control');
  try {
    const installed = await readRuntime(home);
    const state = await manager.verify(installed);
    if (command === 'stop') {
      await manager.stop();
      console.info('Clef service stopped. Your data is unchanged.');
      return;
    }

    const ready = await readiness(home);
    if (ready && (!ready.managed || ready.pid !== state.pid))
      throw new Error('Another Clef process owns this installation. Stop it first.');

    if (command === 'status') {
      printStatus(ready, state.loaded);
      return;
    }
    return await startManaged(home, runtime, manager, state.loaded, ready);
  } finally {
    release();
  }
}

function cliCommand() {
  const command = process.argv[2] ?? 'chat';
  if (
    process.argv.length > 3 ||
    ![
      'chat',
      'start',
      'serve',
      'status',
      'stop',
    ].includes(command)
  )
    throw new Error('Usage: clef [start | status | stop | serve] or clef --server <https-url>');
  if (command === 'chat' && (!process.stdin.isTTY || !process.stdout.isTTY))
    throw new Error('Chat needs an interactive terminal. Use clef start to start the server.');
  return command;
}

export async function runCli(
  entry: string,
  start: StartServer,
  chat: (ready: Ready) => Promise<void>,
) {
  const command = cliCommand();
  const port = Number(process.env.CLEF_PORT ?? 3737);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('CLEF_PORT must be a port number.');
  process.umask(0o077);
  const home = await privateHome(
    process.env.CLEF_HOME ?? join(homedir(), '.local', 'share', 'clef'),
  );
  if (
    [
      home,
      entry,
      process.execPath,
    ].some((path) => /[\r\n\0]/.test(path))
  )
    throw new Error('Clef installation paths cannot contain line breaks or null bytes.');
  if (command === 'serve') return serve(home, port, start);
  const runtime = {
    node: process.execPath,
    entry,
    port,
  };
  if (command === 'chat') {
    const running = await readiness(home);
    if (running) {
      verifyReady(running, runtime);
      return chat(running);
    }
  }
  const ready = await managed(command, home, runtime);
  if (ready) {
    if (command === 'chat') await chat(ready);
    else printReady(ready);
  }
}
