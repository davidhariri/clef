import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, type FileHandle, mkdir, open, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { serverAddress } from './api.js';

function connectionPath(url: string) {
  const root = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  const directory = join(root, 'clef', 'connections');
  const name = createHash('sha256').update(serverAddress(url)).digest('hex');
  return {
    directory,
    path: join(directory, name),
  };
}

export async function savedToken(url: string): Promise<string | undefined> {
  const { path } = connectionPath(url);
  let file: FileHandle;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const status = await file.stat();
    if (!status.isFile() || status.size !== 43 || (status.mode & 0o077) !== 0)
      throw new Error('The saved client token must be a private regular file.');
    const token = await file.readFile('utf8');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid saved client token.');
    return token;
  } finally {
    await file.close();
  }
}

export async function saveToken(url: string, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid client token.');
  const { directory, path } = connectionPath(url);
  await mkdir(directory, {
    recursive: true,
    mode: 0o700,
  });
  await chmod(directory, 0o700);
  const temporary = `${path}.${process.pid}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(token);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}
