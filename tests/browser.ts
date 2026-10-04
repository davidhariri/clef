import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxProvider, type Provider } from '@earendil-works/pi-ai';
import { test as base, expect } from '@playwright/test';
import { createApp } from '../src/server/app.js';

function provider(): Provider {
  const faux = fauxProvider({
    provider: 'openai',
    models: [
      {
        id: 'test-model',
        name: 'Test model',
      },
      {
        id: 'second-model',
        name: 'Second model',
      },
    ],
    tokensPerSecond: 100,
  });
  faux.setResponses(
    Array.from(
      {
        length: 100,
      },
      () => (context) => {
        const last = context.messages.filter((message) => message.role === 'user').at(-1);
        const text = typeof last?.content === 'string' ? last.content : 'hello';
        return fauxAssistantMessage(
          text.includes('slow') ? 'A slow response. '.repeat(1000) : `Clef heard: ${text}`,
        );
      },
    ),
  );
  return {
    ...faux.provider,
    auth: {
      apiKey: {
        name: 'Test key',
        async resolve({ credential }) {
          return credential?.key
            ? {
                auth: {
                  apiKey: credential.key,
                },
              }
            : undefined;
        },
      },
      oauth: {
        name: 'Test OAuth',
        async login(interaction) {
          interaction.notify({
            type: 'auth_url',
            url: 'https://example.com/test-login',
          });
          const answer = await interaction.prompt({
            type: 'manual_code',
            message: 'Paste the callback URL',
          });
          if (answer !== 'test-callback') throw new Error('Incorrect callback');
          return {
            type: 'oauth',
            access: 'test-access',
            refresh: 'test-refresh',
            expires: Date.now() + 3600_000,
          };
        },
        async refresh(value) {
          return value;
        },
        async toAuth(value) {
          return {
            apiKey: value.access,
          };
        },
      },
    },
  };
}

type ClefFixture = {
  url: string;
  setupUrl: string;
  home: string;
  setup: () => Promise<void>;
  restart: () => Promise<void>;
};

export const test = base.extend<{
  clef: ClefFixture;
}>({
  clef: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const home = await mkdtemp(join(tmpdir(), 'clef-browser-'));
    let application = await createApp({
      home,
      providers: [
        provider(),
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
              provider(),
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
