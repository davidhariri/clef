import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openCredentials } from '../credentials/index.js';
import { openFiles } from '../files/index.js';
import { openModels } from '../models/index.js';
import { openPermissions } from '../permissions/index.js';
import { openInstallation } from '../platform/database.js';
import { openAgent } from './index.js';

const spec = {
  root: 'summary',
  elements: {
    summary: {
      type: 'Card',
      props: {
        title: 'Your options',
      },
      children: [
        'text',
      ],
    },
    text: {
      type: 'Text',
      props: {
        text: 'Choose any model you want to discuss.',
      },
    },
  },
  state: {},
};

async function setupPresentation(
  responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0],
) {
  const installation = await testInstallation();
  const credentials = await openCredentials(installation.database, installation.keyPath);
  const provider = fauxProvider({
    provider: 'test',
    models: [
      {
        id: 'test-model',
      },
    ],
    tokensPerSecond: 100000,
  });
  provider.setResponses(responses);
  const models = await openModels(installation.database, credentials.store, installation.settings, [
    provider.provider,
  ]);
  await installation.settings.initialize((configuration) =>
    models.validateConfiguration(configuration),
  );
  const permissions = await openPermissions(installation.database, installation.settings);
  const files = openFiles(installation.home, installation.workspacePath, permissions);
  const agent = await openAgent(
    installation.database,
    models,
    installation.settings,
    permissions,
    files,
  );
  return {
    installation,
    credentials,
    models,
    permissions,
    files,
    agent,
    async dispose() {
      await agent.close();
      permissions.close();
      await credentials.close();
      await installation.dispose();
    },
  };
}

const model = {
  provider: 'test',
  modelId: 'test-model',
  thinkingLevel: 'off',
} as const;

it('presents a model-composed interface and restores it after restart', async () => {
  const setup = await setupPresentation([
    fauxAssistantMessage(fauxToolCall('present_ui', spec), {
      stopReason: 'toolUse',
    }),
  ]);
  const { agent, installation, models, permissions, files } = setup;
  try {
    await agent.open(model);
    await agent.send(
      {
        text: 'Show my options',
        requestId: crypto.randomUUID(),
      },
      model,
    );
    await vi.waitFor(async () => expect((await agent.snapshot()).busy).toBe(false));
    const snapshot = await agent.snapshot();
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages.find((message) => message.ui)?.ui).toEqual({
      spec,
      submitted: false,
    });
    await agent.close();
    const reopened = await openInstallation(installation.home);
    const restored = await openAgent(
      reopened.database,
      models,
      installation.settings,
      permissions,
      files,
    );
    try {
      expect((await restored.snapshot()).messages).toEqual(snapshot.messages);
    } finally {
      await restored.close();
      await reopened.database.close();
    }
  } finally {
    await setup.dispose();
  }
});

it.each([
  {
    name: 'cycle',
    input: {
      ...spec,
      elements: {
        loop: {
          type: 'Card',
          props: {
            title: 'Loop',
          },
          children: [
            'loop',
          ],
        },
      },
      root: 'loop',
    },
  },
  {
    name: 'missing child',
    input: {
      ...spec,
      root: 'missing',
    },
  },
  {
    name: 'shared child',
    input: {
      ...spec,
      elements: {
        ...spec.elements,
        summary: {
          ...spec.elements.summary,
          children: [
            'text',
            'text',
          ],
        },
      },
    },
  },
  {
    name: 'unknown component',
    input: {
      ...spec,
      elements: {
        summary: {
          type: 'Script',
          props: {
            code: 'alert(1)',
          },
        },
      },
    },
  },
  {
    name: 'uninitialized binding',
    input: {
      ...spec,
      elements: {
        summary: {
          type: 'Input',
          props: {
            label: 'Name',
            value: {
              $bindState: '/name',
            },
          },
        },
      },
    },
  },
  {
    name: 'arbitrary action',
    input: {
      ...spec,
      elements: {
        summary: {
          type: 'Button',
          props: {
            label: 'Run',
          },
          on: {
            press: {
              action: 'navigate',
              params: {
                url: 'https://untrusted.example',
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'prototype binding',
    input: {
      ...spec,
      elements: {
        summary: {
          type: 'Input',
          props: {
            label: 'Name',
            value: {
              $bindState: '/__proto__',
            },
          },
        },
      },
    },
  },
  {
    name: 'excessive depth',
    input: {
      ...spec,
      root: 'level0',
      elements: Object.fromEntries(
        Array.from(
          {
            length: 9,
          },
          (_, index) => [
            `level${index}`,
            {
              type: 'Stack',
              props: {
                direction: 'vertical',
              },
              children:
                index === 8
                  ? []
                  : [
                      `level${index + 1}`,
                    ],
            },
          ],
        ),
      ),
    },
  },
  {
    name: 'oversized spec',
    input: {
      ...spec,
      elements: Object.fromEntries(
        Array.from(
          {
            length: 9,
          },
          (_, index) => [
            `text${index}`,
            {
              type: 'Text',
              props: {
                text: 'x'.repeat(4000),
              },
            },
          ],
        ),
      ),
      root: 'text0',
    },
  },
])('rejects $name without exposing an interactive result', async ({ input }) => {
  const setup = await setupPresentation([
    fauxAssistantMessage(fauxToolCall('present_ui', input), {
      stopReason: 'toolUse',
    }),
    (context) => {
      expect(context.messages.at(-1)).toMatchObject({
        role: 'toolResult',
        isError: true,
      });
      return fauxAssistantMessage('The interface was rejected.');
    },
  ]);
  try {
    await setup.agent.open(model);
    await setup.agent.send(
      {
        text: 'Show it',
        requestId: crypto.randomUUID(),
      },
      model,
    );
    await vi.waitFor(async () => expect((await setup.agent.snapshot()).busy).toBe(false), {
      timeout: 10000,
    });
    const view = await setup.agent.snapshot();
    expect(view.messages.some((message) => message.ui)).toBe(false);
    expect(view.messages.at(-1)?.text).toBe('The interface was rejected.');
  } finally {
    await setup.dispose();
  }
});
