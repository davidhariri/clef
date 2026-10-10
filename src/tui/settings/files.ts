import type { ClefClient } from '../../client/index.js';
import { type FileAccessView, fileAccessViewSchema } from '../../server/files/contract.js';
import { directoryAccessSchema, type FileAccess } from '../../server/permissions/contract.js';
import type { Dialogs } from '../components/dialogs.js';

const accessOptions = [
  {
    value: 'read',
    label: 'Read only',
  },
  {
    value: 'read-write',
    label: 'Read and write',
    description: 'Create and overwrite files',
  },
  {
    value: 'deny',
    label: 'No access',
    description: 'Block inherited access',
  },
];

async function directoryPolicy(
  view: FileAccessView,
  dialogs: Dialogs,
  existing?: string,
): Promise<FileAccess | undefined> {
  const path =
    existing ??
    (await dialogs.input('Directory path', {
      detail: 'Use an absolute directory path on the server. Access includes subdirectories.',
    }));
  if (!path) return undefined;
  const current = view.policy.directories.find((rule) => rule.path === path);
  const selected = await dialogs.choose(
    'Directory access',
    [
      ...accessOptions,
      ...(existing
        ? [
            {
              value: 'remove',
              label: 'Remove rule',
            },
          ]
        : []),
    ],
    `${path}\nCurrent access: ${current?.access ?? 'Inherited'}. The most specific directory rule applies.`,
  );
  if (!selected) return undefined;
  if (selected === 'remove') {
    const confirm = await dialogs.choose(
      'Remove directory rule?',
      [
        {
          value: 'cancel',
          label: 'Cancel',
        },
        {
          value: 'remove',
          label: 'Remove rule',
        },
      ],
      `${path}\nRemoving this rule restores inherited access and can increase access.`,
    );
    if (confirm !== 'remove') return undefined;
    return {
      ...view.policy,
      directories: view.policy.directories.filter((rule) => rule.path !== path),
    };
  }

  const rule = {
    path,
    access: directoryAccessSchema.parse(selected),
  };
  return {
    ...view.policy,
    directories: [
      ...view.policy.directories.filter((item) => item.path !== path),
      rule,
    ],
  };
}

async function globalPolicy(
  view: FileAccessView,
  dialogs: Dialogs,
): Promise<FileAccess | undefined> {
  if (!view.policy.global) {
    const confirm = await dialogs.choose(
      'Enable global host file access?',
      [
        {
          value: 'cancel',
          label: 'Cancel',
        },
        {
          value: 'enable',
          label: 'Enable global access',
        },
      ],
      'Allows reads and overwrites across the server filesystem, including mounts. This can change personal files and startup programs. A code sandbox does not prevent this. Files read can reach your model provider. Directory restrictions and private-file protection still apply. Every deletion needs approval.',
    );
    if (confirm !== 'enable') return undefined;
  }

  return {
    ...view.policy,
    global: !view.policy.global,
  };
}

export async function fileAccess(client: ClefClient, dialogs: Dialogs) {
  while (true) {
    const view = await client.request('/api/files/access', fileAccessViewSchema);
    if (view.error) throw new Error(view.error);
    const selected = await dialogs.choose(
      'File access',
      [
        {
          value: 'add',
          label: 'Add directory',
        },
        {
          value: 'global',
          label: view.policy.global ? 'Disable global access' : 'Enable global access',
          description: 'Server-wide read and write access',
        },
        ...view.policy.directories.map((rule) => ({
          value: `directory:${rule.path}`,
          label: rule.path,
          description: `${rule.access}${rule.path === view.workspace ? ' · Workspace' : ''}`,
        })),
        {
          value: 'back',
          label: 'Back',
        },
      ],
      'Directory access includes subdirectories. Read and write includes overwrites. Every deletion needs approval. Files read can reach your model provider. Changes save immediately.',
    );
    if (!selected || selected === 'back') return;
    const path = selected.startsWith('directory:')
      ? selected.slice('directory:'.length)
      : undefined;
    const policy =
      selected === 'global'
        ? await globalPolicy(view, dialogs)
        : await directoryPolicy(view, dialogs, path);
    if (!policy) continue;
    await client.request(
      '/api/files/access',
      fileAccessViewSchema,
      {
        revision: view.revision,
        policy,
        confirmGlobal: selected === 'global' && policy.global,
      },
      'PUT',
    );
  }
}
