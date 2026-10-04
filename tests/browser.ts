import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect } from '@playwright/test';
import { createApp } from '../src/server/app.js';
import { testProvider } from './provider.js';

type ClefFixture = {
  url: string;
  setupUrl: string;
  home: string;
  setup: () => Promise<void>;
  restart: () => Promise<void>;
};

export const test = base.extend<{
  clef: ClefFixture;
  configurationOverrides: Record<string, unknown>;
  modelName: string;
}>({
  configurationOverrides: [
    {},
    {
      option: true,
    },
  ],
  modelName: [
    'Test model',
    {
      option: true,
    },
  ],
  clef: async ({ page, configurationOverrides, modelName }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const home = await mkdtemp(join(tmpdir(), 'clef-browser-'));
    let application = await createApp({
      home,
      providers: [
        testProvider(configurationOverrides, modelName),
      ],
    });
    let url = await application.server.listen({
      port: 0,
      host: '127.0.0.1',
    });
    const port = Number(new URL(url).port);
    try {
      await use({
        home,
        url,
        setupUrl: `${url}/#setup=${application.setupToken}`,
        setup: async () => {
          const account = await page.request.post(`${url}/api/setup`, {
            headers: {
              'x-clef-setup': application.setupToken,
            },
            data: {
              username: 'david',
              password: 'a long test password',
              key: 'a'.repeat(64),
            },
          });
          expect(account.ok()).toBe(true);
          const connection = await page.request.post(`${url}/api/models/key`, {
            data: {
              provider: 'openai',
              key: 'test-api-key',
            },
          });
          expect(connection.ok()).toBe(true);
        },
        restart: async () => {
          await application.server.close();
          application = await createApp({
            home,
            providers: [
              testProvider(configurationOverrides, modelName),
            ],
          });
          url = await application.server.listen({
            port,
            host: '127.0.0.1',
          });
        },
      });
      expect(errors).toEqual([]);
    } finally {
      await application.server.close();
      await rm(home, {
        recursive: true,
        force: true,
      });
    }
  },
});
export { expect };
