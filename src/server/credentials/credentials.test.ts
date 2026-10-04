import { readFile, rm, stat } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openInstallation } from '../platform/database.js';
import { openCredentials } from './index.js';

it('encrypts credentials and unlocks them after restart', async () => {
  const installation = await testInstallation();
  const credentials = await openCredentials(installation.database, installation.keyPath);
  try {
    await credentials.initializeKey('a'.repeat(64));
    await credentials.store.modify('openai', async () => ({
      type: 'api_key',
      key: 'secret-test-key',
    }));
    expect(await credentials.store.list()).toEqual([
      {
        providerId: 'openai',
        type: 'api_key',
      },
    ]);
    expect((await stat(installation.keyPath)).mode & 0o777).toBe(0o600);
    await credentials.close();
    await installation.database.close();
    expect((await readFile(installation.databasePath)).includes('secret-test-key')).toBe(false);
    const reopened = await openInstallation(installation.home);
    const restored = await openCredentials(reopened.database, reopened.keyPath);
    try {
      expect(restored.locked).toBe(false);
      expect(await restored.store.read('openai')).toEqual({
        type: 'api_key',
        key: 'secret-test-key',
      });
    } finally {
      await restored.close();
      await reopened.database.close();
    }
  } finally {
    await credentials.close();
    await installation.dispose();
  }
});

it('does not replace a missing installation key and accepts only the original recovery key', async () => {
  const installation = await testInstallation();
  const credentials = await openCredentials(installation.database, installation.keyPath);
  try {
    await credentials.initializeKey('a'.repeat(64));
    await credentials.store.modify('openai', async () => ({
      type: 'api_key',
      key: 'saved-secret',
    }));
    await credentials.close();
    await rm(installation.keyPath);
    const locked = await openCredentials(installation.database, installation.keyPath);
    try {
      expect(locked.locked).toBe(true);
      await expect(stat(installation.keyPath)).rejects.toThrow();
      await expect(locked.store.read('openai')).rejects.toThrow();
      await expect(locked.recover('b'.repeat(64))).rejects.toThrow();
      await locked.recover('a'.repeat(64));
      expect(await locked.store.read('openai')).toEqual({
        type: 'api_key',
        key: 'saved-secret',
      });
    } finally {
      await locked.close();
    }
  } finally {
    await credentials.close();
    await installation.dispose();
  }
});
