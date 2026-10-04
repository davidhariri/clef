import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Model,
  type Provider,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { test as base, expect } from '@playwright/test';
import { createApp } from '../src/server/app.js';

function configurationResponse(
  context: TranscriptContext,
  text: string,
  model: Model<string>,
  overrides: Record<string, unknown>,
) {
  const last = context.messages.at(-1);
  if (last?.role === 'toolResult' && last.toolName === 'settings_change')
    return fauxAssistantMessage(
      `Configuration finished on ${model.id}. ${last.isError ? 'Rejected.' : 'Applied.'}`,
    );
  if (last?.role === 'toolResult' && last.toolName === 'settings_inspect') {
    if (last.isError) return fauxAssistantMessage('Configuration inspection rejected.');
    const part = last.content.find((item) => item.type === 'text');
    const view = JSON.parse(part?.type === 'text' ? part.text : '{}');
    return fauxAssistantMessage(
      fauxToolCall('settings_change', {
        revision: view.revision,
        defaults: {
          provider: 'openai',
          modelId: text.includes('original') ? 'test-model' : 'second-model',
          thinkingLevel: 'off',
        },
        switchConversation: !text.includes('defaults only'),
        ...overrides,
      }),
      {
        stopReason: 'toolUse',
      },
    );
  }
  return fauxAssistantMessage(fauxToolCall('settings_inspect', {}), {
    stopReason: 'toolUse',
  });
}

function provider(overrides: Record<string, unknown>, modelName: string): Provider {
  const faux = fauxProvider({
    provider: 'openai',
    models: [
      {
        id: 'test-model',
        name: modelName,
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
      () => (context, _options, _state, model) => {
        const last = context.messages.filter((message) => message.role === 'user').at(-1);
        const text = typeof last?.content === 'string' ? last.content : 'hello';
        if (text.startsWith('configure '))
          return configurationResponse(context, text, model, overrides);
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
        provider(configurationOverrides, modelName),
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
              provider(configurationOverrides, modelName),
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
