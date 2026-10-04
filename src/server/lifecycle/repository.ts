import { join } from 'node:path';
import { z } from 'zod';
import { acquireProcessLock, ProcessLockBusyError } from '../platform/database.js';
import { readOptional, writePrivate } from './storage.js';

const runtimeSchema = z.object({
  node: z.string(),
  entry: z.string(),
  port: z.number().int().min(1).max(65535),
});
export type Runtime = z.infer<typeof runtimeSchema>;

export async function readRuntime(home: string) {
  const record = await readOptional(join(home, 'service.json'));
  return record ? runtimeSchema.parse(JSON.parse(record)) : undefined;
}

export async function writeRuntime(home: string, runtime: Runtime) {
  await writePrivate(join(home, 'service.json'), JSON.stringify(runtime));
}

export async function lock(home: string, name: 'owner' | 'control') {
  try {
    return await acquireProcessLock(join(home, `${name}.sqlite`));
  } catch (error) {
    if (error instanceof ProcessLockBusyError)
      throw new Error(`Another Clef process owns this installation (${name}).`);
    throw error;
  }
}
