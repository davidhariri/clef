import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Conversation, Harness } from '@earendil-works/pi-durable';
import type { ConversationInfo, ConversationSnapshot } from '../messages/contract.js';
import type { ModelSettings } from '../models/contract.js';
import { projectConversation } from './model.js';
import type { AgentRepository } from './repository.js';

const context = BACKGROUND_CONTEXT;

export class Agent {
  private readonly conversations = new Map<string, Conversation>();
  private closed = false;

  constructor(
    private readonly harness: Harness,
    private readonly repository: AgentRepository,
  ) {}

  async restore(): Promise<void> {
    for (const record of await this.repository.conversations()) {
      const conversation = await this.harness.conversation(record.id, context);
      if (conversation) this.conversations.set(String(record.id), conversation);
    }
  }

  async create(model: ModelSettings): Promise<ConversationInfo> {
    const conversation = await this.harness.createConversation(
      {
        ownership: {
          kind: 'ownerless',
        },
        agent: {
          model: {
            provider: model.provider,
            modelId: model.modelId,
          },
          thinkingLevel: model.thinkingLevel,
          instructions:
            'You are Clef, a personal assistant. Be direct, thoughtful, and useful. Ask when intent is unclear. Never claim to have performed an action without tool evidence. No tools are available in this chat build. Say so when asked to browse or act. Do not invent results.',
        },
      },
      context,
    );
    const id = String(conversation.id);
    this.conversations.set(id, conversation);

    return (await this.snapshot(id)).conversation;
  }

  async list(): Promise<ConversationInfo[]> {
    const result: ConversationInfo[] = [];
    for (const id of this.conversations.keys()) result.push((await this.snapshot(id)).conversation);

    return result.reverse();
  }

  async snapshot(id: string): Promise<ConversationSnapshot> {
    const watch = await this.require(id).watch(context);

    try {
      return projectConversation(watch.value);
    } finally {
      await watch.stop();
    }
  }

  async watch(
    id: string,
    listener: (snapshot: ConversationSnapshot) => Promise<void>,
  ): Promise<() => Promise<void>> {
    const watch = await this.require(id).watch(context);
    await listener(projectConversation(watch.value));
    watch.start(async (view) => listener(projectConversation(view)));

    return async () => {
      await watch.stop();
    };
  }

  async send(id: string, text: string, requestId: string): Promise<void> {
    await this.require(id).submit(
      {
        type: 'input',
        content: text,
        requestId,
        whenBusy: 'reject',
      },
      context,
    );
  }

  async stop(id: string): Promise<void> {
    await this.require(id).abort(context);
  }

  private require(id: string): Conversation {
    const conversation = this.conversations.get(id);
    if (!conversation) throw new Error('Conversation not found.');

    return conversation;
  }

  async close(): Promise<void> {
    if (this.closed) return;

    this.closed = true;
    for (const conversation of this.conversations.values()) await conversation.abort(context);
    await this.harness.close(context);
  }
}
