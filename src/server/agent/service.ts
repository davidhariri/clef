import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Conversation, ConversationView, Harness } from '@earendil-works/pi-durable';
import type {
  ConversationInfo,
  ConversationSnapshot,
  ConversationSummary,
} from '../messages/contract.js';
import type { ModelSettings } from '../models/contract.js';
import { HttpError } from '../platform/http.js';
import { summarizeConversation } from './history.js';
import { projectConversation } from './model.js';
import type { AgentRepository } from './repository.js';

const context = BACKGROUND_CONTEXT;

export class Agent {
  private conversation: Promise<Conversation> | undefined;
  private readonly conversations = new Map<string, Conversation>();
  private closed = false;
  private readonly submitting = new Set<string>();

  constructor(
    private readonly harness: Harness,
    private readonly repository: AgentRepository,
  ) {}

  async restore(): Promise<void> {
    const record = await this.repository.latestConversation();
    if (!record) return;

    const conversation = await this.harness.conversation(record.id, context);
    if (conversation) {
      this.conversations.set(String(conversation.id), conversation);
      this.conversation = Promise.resolve(conversation);
    }
  }

  async open(model: ModelSettings, id?: string): Promise<ConversationInfo> {
    const conversation =
      id === undefined ? await (this.conversation ?? this.create(model)) : await this.require(id);

    return (await this.snapshot(String(conversation.id))).conversation;
  }

  async createMain(model: ModelSettings): Promise<ConversationInfo> {
    const conversation = await this.create(model);
    return (await this.snapshot(String(conversation.id))).conversation;
  }

  async history(query: string): Promise<ConversationSummary[]> {
    const main = await this.require();
    const history = [];
    for (const record of await this.repository.conversations()) {
      const entries = this.repository.entries(record.id);
      history.push(await summarizeConversation(record, entries, String(main.id)));
    }
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return history
      .filter((item) => item.main || words.every((word) => item.title.toLowerCase().includes(word)))
      .sort((a, b) => Number(b.main) - Number(a.main) || b.activity - a.activity)
      .slice(0, 50)
      .map(({ activity: _activity, ...item }) => item);
  }

  private create(model: ModelSettings): Promise<Conversation> {
    const previous = this.conversation;
    const pending = this.harness
      .createConversation(
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
              'You are Clef, a personal assistant. Be direct, thoughtful, and useful. Ask when intent is unclear. Never claim to have performed an action without tool evidence. Only settings_inspect and settings_change are available. Inspect the active revision before requesting a model-default change. User approval is required; a request in chat is not approval. An approved self-switch changes this reply at its next model request. Saved defaults otherwise apply to the next user message. You cannot edit permissions, secret references or endpoints, browse, run scripts, use a shell, or access files. Never ask for secrets in chat. Do not invent results.',
          },
        },
        context,
      )
      .then((conversation) => {
        this.conversations.set(String(conversation.id), conversation);
        return conversation;
      })
      .catch((error: unknown) => {
        if (this.conversation === pending) this.conversation = previous;
        throw error;
      });
    this.conversation = pending;
    return pending;
  }

  private async project(view: ConversationView): Promise<ConversationSnapshot> {
    const submissions = await this.repository.unanswered(view.conversation.id);
    return projectConversation(view, submissions);
  }

  async snapshot(id?: string): Promise<ConversationSnapshot> {
    const conversation = await this.require(id);
    const watch = await conversation.watch(context);

    try {
      return await this.project(watch.value);
    } finally {
      await watch.stop();
    }
  }

  async watch(
    listener: (snapshot: ConversationSnapshot) => Promise<void>,
    id?: string,
  ): Promise<() => Promise<void>> {
    const conversation = await this.require(id);
    const watch = await conversation.watch(context);
    await listener(await this.project(watch.value));
    watch.start(async (view) => listener(await this.project(view)));

    return async () => {
      await watch.stop();
    };
  }

  async send(text: string, requestId: string, model: ModelSettings, id?: string): Promise<void> {
    const conversation = await this.require(id);
    const key = String(conversation.id);
    if (this.submitting.has(key)) throw new Error('A message is being submitted.');

    this.submitting.add(key);
    try {
      if (!(await this.snapshot(key)).busy) {
        await conversation.configure(
          {
            model: {
              provider: model.provider,
              modelId: model.modelId,
            },
            thinkingLevel: model.thinkingLevel,
          },
          context,
        );
      }

      await conversation.submit(
        {
          type: 'input',
          content: text,
          requestId,
          whenBusy: 'reject',
        },
        context,
      );
    } finally {
      this.submitting.delete(key);
    }
  }

  async stop(id?: string): Promise<void> {
    const conversation = await this.require(id);
    await conversation.abort(context);
  }

  private async require(id?: string): Promise<Conversation> {
    if (id === undefined) {
      if (this.conversation === undefined) throw new Error('Open the conversation first.');
      return this.conversation;
    }
    const cached = this.conversations.get(id);
    if (cached) return cached;
    const record = (await this.repository.conversations()).find(
      (record) => String(record.id) === id,
    );
    const conversation = record && (await this.harness.conversation(record.id, context));
    if (!conversation) throw new HttpError(404, 'Conversation not found.');
    this.conversations.set(id, conversation);
    return conversation;
  }

  async close(): Promise<void> {
    if (this.closed) return;

    this.closed = true;
    for (const conversation of this.conversations.values()) await conversation.abort(context);
    await this.harness.close(context);
  }
}
