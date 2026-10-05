import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Model,
  type Provider,
  type TranscriptContext,
} from '@earendil-works/pi-ai';

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

function fileResponse(context: TranscriptContext, text: string) {
  const result = context.messages.at(-1);
  if (result?.role === 'toolResult' && result.toolName === 'files') {
    const content = result.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    return fauxAssistantMessage(
      result.isError ? 'File action rejected.' : `File action completed. ${content}`,
    );
  }
  return fauxAssistantMessage(fauxToolCall('files', JSON.parse(text.slice(5))), {
    stopReason: 'toolUse',
  });
}

export function testProvider(
  overrides: Record<string, unknown> = {},
  modelName = 'Test model',
): Provider {
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
        if (text.startsWith('file ')) return fileResponse(context, text);
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
