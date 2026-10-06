import type { SelectItem } from '@earendil-works/pi-tui';
import type { ClefClient } from '../../client/index.js';
import { historySchema } from '../../server/messages/contract.js';
import type { Dialogs } from '../components/dialogs.js';
import { safeText } from '../components/theme.js';

export async function conversationItems(
  client: ClefClient,
  query: string,
  signal: AbortSignal,
): Promise<SelectItem[]> {
  const history = await client.request(
    `/api/conversations?query=${encodeURIComponent(query)}`,
    historySchema,
    undefined,
    'GET',
    signal,
  );
  return history.conversations.map((conversation) => ({
    value: conversation.main ? 'main' : `id:${conversation.id}`,
    label: safeText(conversation.main ? `✦ Main · ${conversation.title}` : conversation.title),
  }));
}

export async function chooseConversation(
  client: ClefClient,
  dialogs: Dialogs,
  query: string,
): Promise<
  | {
      id?: string;
    }
  | undefined
> {
  const selected =
    query === 'main' || /^id:[1-9]\d*$/.test(query)
      ? query
      : await dialogs.choose(
          'Switch conversation',
          (search, signal) => conversationItems(client, search, signal),
          '',
          query,
        );
  if (selected === undefined) return undefined;
  return selected === 'main'
    ? {}
    : {
        id: selected.slice(3),
      };
}
