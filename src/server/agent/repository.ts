import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { ConversationRecord, Cursor } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import type { Database } from '../platform/database.js';

export class AgentRepository {
  private constructor(readonly storage: SqliteStorage) {}
  static async open(database: Database): Promise<AgentRepository> {
    return new AgentRepository(await SqliteStorage.open(database));
  }
  async conversations(): Promise<ConversationRecord[]> {
    const records: ConversationRecord[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await this.storage.scanConversations({}, 100, cursor, BACKGROUND_CONTEXT);
      records.push(...page.items);
      cursor = page.next;
    } while (cursor);
    return records;
  }
}
