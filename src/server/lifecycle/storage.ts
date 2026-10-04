import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';

export async function privateHome(path: string) {
  await mkdir(path, {
    recursive: true,
    mode: 0o700,
  });
  const home = await realpath(path);
  await chmod(home, 0o700);
  return home;
}

export async function readOptional(path: string) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writePrivate(path: string, content: string) {
  await writeFile(path, content, {
    mode: 0o600,
  });
  await chmod(path, 0o600);
}
