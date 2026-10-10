import { setTimeout as delay } from 'node:timers/promises';
import type { ClefClient } from '../../client/index.js';
import { okSchema } from '../../server/access/contract.js';
import { catalogSchema, type LoginState, loginStateSchema } from '../../server/models/contract.js';
import type { Dialogs } from '../components/dialogs.js';

export async function defaultModel(client: ClefClient, dialogs: Dialogs) {
  const catalog = await client.request('/api/models', catalogSchema);
  if (catalog.configurationError) throw new Error(catalog.configurationError);
  const selected = await dialogs.choose(
    'Default model',
    catalog.models.map((model, index) => ({
      value: String(index),
      label: model.name,
      description: `${model.provider} · ${model.id}`,
    })),
    catalog.models.length ? '' : 'Connect a provider first.',
  );
  if (selected === undefined) return;
  const model = catalog.models[Number(selected)];
  if (!model) return;
  const thinkingLevel = await dialogs.choose(
    'Thinking level',
    model.thinkingLevels.map((level) => ({
      value: level,
      label: level,
    })),
  );
  if (!thinkingLevel) return;
  await client.request(
    '/api/models/default',
    okSchema,
    {
      provider: model.provider,
      modelId: model.id,
      thinkingLevel,
      revision: catalog.revision,
    },
    'PUT',
  );
}

async function loginStep(
  client: ClefClient,
  dialogs: Dialogs,
  state: LoginState,
): Promise<boolean> {
  const detail = [
    state.message,
    state.url,
  ]
    .filter(Boolean)
    .join('\n');
  if (state.state === 'waiting') {
    const answer = state.choices.length
      ? await dialogs.choose(
          state.prompt ?? 'Provider sign-in',
          state.choices.map((choice) => ({
            value: choice.id,
            label: choice.label,
          })),
          detail,
        )
      : await dialogs.input(state.prompt ?? 'Provider sign-in', {
          detail,
          secret: true,
        });
    if (answer === undefined) return false;
    await client.request(`/api/models/login/${state.id}`, okSchema, {
      answer,
    });
    return true;
  }
  if (!state.url) return true;
  return (
    (await dialogs.choose(
      'Provider sign-in',
      [
        {
          value: 'check',
          label: 'Check sign-in',
        },
      ],
      detail,
    )) !== undefined
  );
}

async function providerLogin(
  client: ClefClient,
  dialogs: Dialogs,
  provider: string,
  signal: AbortSignal,
) {
  let state = await client.request('/api/models/login', loginStateSchema, {
    provider,
  });
  try {
    while (!signal.aborted) {
      state = await client.request(`/api/models/login/${state.id}`, loginStateSchema);
      if (state.state === 'done') return;
      if (state.state === 'failed') throw new Error(state.message);
      if (!(await loginStep(client, dialogs, state))) return;
      await delay(300, undefined, {
        signal,
      });
    }
  } finally {
    if (state.state !== 'done')
      await client.request(`/api/models/login/${state.id}`, okSchema, undefined, 'DELETE');
  }
}

export async function connections(client: ClefClient, dialogs: Dialogs, signal: AbortSignal) {
  const catalog = await client.request('/api/models', catalogSchema);
  const provider = await dialogs.choose(
    'Connections',
    catalog.providers.map((item) => ({
      value: item.id,
      label: item.name,
      description: item.error ?? (item.connected ? 'Connected' : 'Not connected'),
    })),
  );
  if (!provider) return;
  if (provider === 'ollama') {
    const url = await dialogs.input('Ollama server URL', {
      value:
        catalog.providers.find((item) => item.id === provider)?.url ?? 'http://127.0.0.1:11434',
      detail: 'Reached by the Clef server. Use only a trusted network.',
    });
    if (url)
      await client.request('/api/models/ollama', okSchema, {
        url,
      });
    return;
  }
  const entry = catalog.providers.find((item) => item.id === provider);
  const method = await dialogs.choose(entry?.name ?? provider, [
    ...(entry?.oauth
      ? [
          {
            value: 'login',
            label: provider === 'openai' ? 'Sign in with ChatGPT' : 'Sign in',
          },
        ]
      : []),
    {
      value: 'key',
      label: 'API key',
      description:
        provider === 'openai'
          ? 'Separate API billing; not a ChatGPT subscription.'
          : 'Stored encrypted on the server.',
    },
  ]);
  if (method === 'login') await providerLogin(client, dialogs, provider, signal);
  if (method === 'key') {
    const key = await dialogs.input('API key', {
      secret: true,
    });
    if (key)
      await client.request('/api/models/key', okSchema, {
        provider,
        key,
      });
  }
}
