import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type APIRequestContext, test as base, expect } from '@playwright/test';
import { ClefClient } from '../src/client/index.js';
import { createApp } from '../src/server/app.js';
import { snapshotSchema } from '../src/server/messages/contract.js';
import { settingsViewSchema } from '../src/server/settings/contract.js';
import { testProvider } from './provider.js';

type Fixture = {
  home: string;
  url: string;
  token: string;
  request: APIRequestContext;
  client: ClefClient;
  connect: () => Promise<void>;
  restart: () => Promise<void>;
  send: (text: string) => Promise<void>;
  snapshot: () => Promise<ReturnType<typeof snapshotSchema.parse>>;
  settings: () => Promise<ReturnType<typeof settingsViewSchema.parse>>;
};

export const test = base.extend<{
  clef: Fixture;
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
  clef: async ({ playwright, configurationOverrides, modelName }, use) => {
    const home = await mkdtemp(join(tmpdir(), 'clef-api-e2e-'));
    const providers = () => [
      testProvider(configurationOverrides, modelName),
    ];
    let app = await createApp({
      home,
      providers: providers(),
    });
    const url = await app.server.listen({
      port: 0,
      host: '127.0.0.1',
    });
    const request = await playwright.request.newContext({
      baseURL: url,
      extraHTTPHeaders: {
        authorization: `Bearer ${app.localToken}`,
      },
    });
    try {
      await use({
        home,
        url,
        token: app.localToken,
        request,
        client: new ClefClient(url, app.localToken),
        connect: async () => {
          const response = await request.post('/api/models/key', {
            data: {
              provider: 'openai',
              key: 'test-api-key',
            },
          });
          expect(response.ok(), await response.text()).toBe(true);
        },
        restart: async () => {
          await app.server.close();
          app = await createApp({
            home,
            providers: providers(),
          });
          await app.server.listen({
            port: Number(new URL(url).port),
            host: '127.0.0.1',
          });
        },
        send: async (text) => {
          const response = await request.post('/api/conversation/messages', {
            data: {
              text,
              requestId: randomUUID(),
            },
          });
          expect(response.ok(), await response.text()).toBe(true);
        },
        snapshot: async () =>
          snapshotSchema.parse(await (await request.get('/api/conversation')).json()),
        settings: async () =>
          settingsViewSchema.parse(await (await request.get('/api/settings')).json()),
      });
    } finally {
      await request.dispose();
      await app.server.close();
      await rm(home, {
        recursive: true,
        force: true,
      });
    }
  },
});
export { expect };
