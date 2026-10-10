import type { ClefClient } from '../../client/index.js';
import { clientsSchema, issuedClientSchema, okSchema } from '../../server/access/contract.js';
import type { Dialogs } from '../components/dialogs.js';

export async function clients(client: ClefClient, dialogs: Dialogs) {
  const view = await client.request('/api/access/clients', clientsSchema);
  const selected = await dialogs.choose(
    'Client access',
    [
      {
        value: 'add',
        label: 'Add client',
      },
      ...view.clients.map((item) => ({
        value: item.id,
        label: item.name,
        description: 'Revoke access',
      })),
    ],
    'Each remote client uses its own token. Manage access from the server host.',
  );
  if (!selected) return;
  if (selected === 'add') {
    const name = await dialogs.input('Client name');
    if (!name) return;
    const issued = await client.request('/api/access/clients', issuedClientSchema, {
      name,
    });
    await dialogs.choose(
      'Client token',
      [
        {
          value: 'done',
          label: 'Done',
        },
      ],
      `${issued.token}\nSave this token now. It will not be shown again. On the other machine, run clef --server https://your-server and paste it when asked.`,
    );
    return;
  }
  const confirm = await dialogs.choose(
    'Revoke client access?',
    [
      {
        value: 'cancel',
        label: 'Cancel',
      },
      {
        value: 'revoke',
        label: 'Revoke access',
      },
    ],
    view.clients.find((item) => item.id === selected)?.name ?? '',
  );
  if (confirm === 'revoke')
    await client.request(`/api/access/clients/${selected}`, okSchema, undefined, 'DELETE');
}
