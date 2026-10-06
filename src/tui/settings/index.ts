import { stringify } from 'yaml';
import type { ClefClient } from '../../client/index.js';
import { okSchema, statusSchema } from '../../server/access/contract.js';
import { settingsViewSchema } from '../../server/settings/contract.js';
import type { Dialogs } from '../components/dialogs.js';
import { clients } from './access.js';
import { connections, defaultModel } from './models.js';

async function permissions(client: ClefClient, dialogs: Dialogs) {
  const view = await client.request('/api/settings', settingsViewSchema);
  const rules = view.active.permissions;
  const selected = await dialogs.choose(
    'Saved permissions',
    rules.map((rule, index) => ({
      value: String(index),
      label: `${rule.decision} · ${'kind' in rule ? `${rule.defaults.provider}/${rule.defaults.modelId}` : rule.origin}`,
      description:
        'kind' in rule
          ? `${rule.defaults.thinkingLevel} · ${rule.switchConversation ? 'Switch current reply' : 'Defaults only'} · ${rule.conversationId}`
          : rule.method,
    })),
    rules.length
      ? 'Select a rule to revoke it.'
      : 'No saved rules. Code execution is not enabled in this build.',
  );
  if (selected === undefined) return;
  const confirm = await dialogs.choose('Revoke this rule?', [
    {
      value: 'cancel',
      label: 'Cancel',
    },
    {
      value: 'revoke',
      label: 'Revoke',
    },
  ]);
  if (confirm !== 'revoke') return;
  await client.request(
    '/api/settings',
    settingsViewSchema,
    {
      revision: view.revision,
      source: stringify({
        ...view.active,
        permissions: rules.filter((_rule, index) => index !== Number(selected)),
      }),
    },
    'PUT',
  );
}

async function recover(client: ClefClient, dialogs: Dialogs) {
  const key = await dialogs.input('Restore encryption key', {
    secret: true,
    detail: 'Provider secrets are locked. Restore the original 64-character key.',
  });
  if (!key) return false;
  await client.request('/api/credentials/recover', okSchema, {
    key,
  });
  return true;
}

export async function settings(client: ClefClient, dialogs: Dialogs, signal: AbortSignal) {
  const sections = [
    {
      value: 'model',
      label: 'Default model',
      run: () => defaultModel(client, dialogs),
    },
    {
      value: 'connections',
      label: 'Connections',
      run: () => connections(client, dialogs, signal),
    },
    {
      value: 'permissions',
      label: 'Saved permissions',
      run: () => permissions(client, dialogs),
    },
    {
      value: 'clients',
      label: 'Client access',
      run: () => clients(client, dialogs),
    },
  ];
  let notice = '';
  while (!signal.aborted) {
    const status = await client.request('/api/status', statusSchema);
    if (status.phase === 'locked') {
      if (!(await recover(client, dialogs))) return;
      continue;
    }
    const selected = await dialogs.choose(
      'Settings',
      [
        ...sections.filter((section) => section.value !== 'clients' || status.local),
        {
          value: 'back',
          label: 'Back to chat',
        },
      ],
      notice ||
        (status.phase === 'connect' ? 'Connect a model provider to start chatting.' : client.url),
    );
    const section = sections.find((item) => item.value === selected);
    if (!section) return;
    try {
      await section.run();
      notice = 'Saved changes apply to the next message.';
    } catch (error) {
      notice = String(error);
    }
  }
}
