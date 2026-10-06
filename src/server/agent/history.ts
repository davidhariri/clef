import type { ConversationRecord, EntryRecord } from '@earendil-works/pi-durable';
import type { ConversationSummary } from '../messages/contract.js';

export async function summarizeConversation(
  record: ConversationRecord,
  entries: AsyncIterable<EntryRecord>,
  mainId: string,
): Promise<
  ConversationSummary & {
    activity: number;
  }
> {
  let title = 'New conversation';
  let activity: number = record.id;
  for await (const entry of entries) {
    activity = Math.max(activity, entry.id);
    const user = entry.model?.find((message) => message.role === 'user');
    if (!user) continue;
    const text =
      typeof user.content === 'string'
        ? user.content
        : user.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join(' ');
    title = text.trim().split(/\r?\n/, 1)[0]?.slice(0, 120) || 'New conversation';
  }

  return {
    id: String(record.id),
    title,
    main: String(record.id) === mainId,
    activity,
  };
}
