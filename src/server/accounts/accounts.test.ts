import { expect, it } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openCredentials } from '../credentials/index.js';
import { openAccounts } from './index.js';

it('creates one account, verifies passwords, and revokes sessions', async () => {
  const installation = await testInstallation();
  const credentials = await openCredentials(installation.database, installation.keyPath);
  try {
    const accounts = await openAccounts(installation.database, (key) =>
      credentials.initializeKey(key),
    );
    await accounts.setup({
      username: 'david',
      password: 'a long test password',
      key: 'a'.repeat(64),
    });
    expect(await accounts.verifyPassword('david', 'wrong')).toBe(false);
    expect(await accounts.verifyPassword('david', 'a long test password')).toBe(true);
    const session = await accounts.createSession();
    expect(await accounts.sessionValid(session)).toBe(true);
    await accounts.endSession(session);
    expect(await accounts.sessionValid(session)).toBe(false);
    await expect(
      accounts.setup({
        username: 'intruder',
        password: 'different password',
        key: 'b'.repeat(64),
      }),
    ).rejects.toThrow('already complete');
  } finally {
    await credentials.close();
    await installation.dispose();
  }
});
