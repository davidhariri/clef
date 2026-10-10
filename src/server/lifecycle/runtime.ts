import { once } from 'node:events';
import { chmod, rm } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';
import { lock } from './repository.js';

const readySchema = z.object({
  pid: z.number().int().positive(),
  url: z.url(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  managed: z.boolean(),
});
export type Ready = z.infer<typeof readySchema>;
export type StartServer = (
  home: string,
  port: number,
) => Promise<{
  url: string;
  token: string;
  close: () => Promise<void>;
}>;

function socketPath(home: string) {
  const path = join(home, 'runtime.sock');
  const limit = process.platform === 'darwin' ? 103 : 107;
  if (Buffer.byteLength(path) > limit)
    throw new Error(`The Unix socket path exceeds ${limit} bytes. Choose a shorter CLEF_HOME.`);
  return path;
}

export async function readiness(home: string): Promise<Ready | undefined> {
  const socket = createConnection(socketPath(home));
  socket.setTimeout(1000, () => socket.destroy(new Error('Clef readiness timed out.')));
  try {
    let text = '';
    for await (const chunk of socket) {
      text += chunk.toString();
      if (text.length > 8192) throw new Error('Invalid Clef readiness response.');
    }
    try {
      return readySchema.parse(JSON.parse(text));
    } catch {
      throw new Error(
        'The running Clef server uses an incompatible readiness format. Stop it with its original launcher, then start this version.',
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      [
        'ENOENT',
        'ECONNREFUSED',
      ].includes(String(error.code))
    )
      return undefined;
    throw error;
  } finally {
    socket.destroy();
  }
}

export async function checkPort(port: number) {
  const listener = createServer();
  try {
    listener.listen(port, '127.0.0.1');
    await once(listener, 'listening');
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE')
      throw new Error(
        `Port ${port} is already in use by another server. Choose CLEF_PORT or stop that server yourself.`,
      );
    throw error;
  }
}

export async function serve(home: string, port: number, start: StartServer) {
  const path = socketPath(home);
  const unlock = await lock(home, 'owner');
  try {
    await checkPort(port);
    const application = await start(home, port);
    const managed = process.env.CLEF_MANAGED === '1';
    await rm(path, {
      force: true,
    });
    const socket = createServer((connection) => {
      connection.on('error', () => connection.destroy());
      connection.end(
        JSON.stringify({
          pid: process.pid,
          url: application.url,
          token: application.token,
          managed,
        }),
      );
    });
    socket.listen(path);
    await once(socket, 'listening');
    await chmod(path, 0o600);
    if (!managed)
      printReady({
        pid: process.pid,
        url: application.url,
        token: application.token,
        managed,
      });
    for (const signal of [
      'SIGINT',
      'SIGTERM',
    ] as const) {
      process.once(signal, () => {
        socket.close();
        application.close().then(
          () => {
            unlock();
            process.exit(0);
          },
          () => {
            unlock();
            process.exit(1);
          },
        );
      });
    }
  } catch (error) {
    unlock();
    throw error;
  }
}

export function printReady(ready: Ready) {
  console.info(`Clef: ${ready.url}`);
}
