import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type {
  ConversationId,
  ConversationRecord,
  Cursor,
  EntryRecord,
  SubmissionRecord,
} from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import type { Database } from '../platform/database.js';

export class AgentRepository {
  private constructor(readonly storage: SqliteStorage) {}

  static async open(database: Database): Promise<AgentRepository> {
    return new AgentRepository(await SqliteStorage.open(database));
  }

  async unanswered(conversationId: ConversationId): Promise<SubmissionRecord[]> {
    const submissions: SubmissionRecord[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await this.storage.scanSubmissions(
        {
          conversationId,
          status: 'unanswered',
        },
        100,
        cursor,
        BACKGROUND_CONTEXT,
      );
      submissions.push(...page.items);
      cursor = page.next;
    } while (cursor);
    return submissions;
  }

  async *entries(conversationId: ConversationId): AsyncGenerator<EntryRecord> {
    let cursor: Cursor | undefined;
    do {
      const page = await this.storage.scanEntries(
        {
          conversationId,
        },
        100,
        cursor,
        BACKGROUND_CONTEXT,
      );
      yield* page.items;
      cursor = page.next;
    } while (cursor);
  }

  async conversations(): Promise<ConversationRecord[]> {
    const records: ConversationRecord[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await this.storage.scanConversations({}, 100, cursor, BACKGROUND_CONTEXT);
      records.push(...page.items.filter((record) => !record.owner));
      cursor = page.next;
    } while (cursor);

    return records;
  }

  async latestConversation(): Promise<ConversationRecord | undefined> {
    return (await this.conversations()).at(-1);
  }
}
