import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openInstallation } from '../src/server/platform/database.js';

export async function testInstallation() {
  const home = await mkdtemp(join(tmpdir(), 'clef-test-'));
  const installation = await openInstallation(home);
  return {
    ...installation,
    async dispose() {
      await installation.database.close();
      await rm(home, {
        recursive: true,
        force: true,
      });
    },
  };
}
