import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.js';
import { openInstallation } from '../src/server/platform/database.js';
import { Settings } from '../src/server/settings/index.js';
import { testProvider } from './provider.js';

export async function testApplication() {
  const home = await mkdtemp(join(tmpdir(), 'clef-api-'));
  let application = await createApp({
    home,
    providers: [
      testProvider(),
    ],
  });
  const headers = {
    host: '127.0.0.1:3737',
    cookie: '',
  };
  const dispose = async () => {
    await application.server.close();
    await rm(home, {
      recursive: true,
      force: true,
    });
  };

  try {
    const account = await application.server.inject({
      method: 'POST',
      url: '/api/setup',
      headers: {
        ...headers,
        'x-clef-setup': application.setupToken,
      },
      payload: {
        username: 'david',
        password: 'a long test password',
        key: 'a'.repeat(64),
      },
    });
    assert.equal(account.statusCode, 200, account.body);
    const session = account.cookies.find((cookie) => cookie.name === 'clef');
    assert.ok(session);
    headers.cookie = `clef=${session.value}`;
    const connection = await application.server.inject({
      method: 'POST',
      url: '/api/models/key',
      headers,
      payload: {
        provider: 'openai',
        key: 'test-api-key',
      },
    });
    assert.equal(connection.statusCode, 200, connection.body);
  } catch (error) {
    await dispose();
    throw error;
  }

  return {
    home,
    headers,
    get server() {
      return application.server;
    },
    async restart() {
      await application.server.close();
      application = await createApp({
        home,
        providers: [
          testProvider(),
        ],
      });
    },
    dispose,
  };
}

export async function testInstallation() {
  const home = await mkdtemp(join(tmpdir(), 'clef-test-'));
  const installation = await openInstallation(home);
  return {
    ...installation,
    settings: new Settings(home),
    async dispose() {
      await installation.database.close();
      await rm(home, {
        recursive: true,
        force: true,
      });
    },
  };
}
