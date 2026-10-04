import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Conversation, Harness } from '@earendil-works/pi-durable';
import type { ConversationInfo, ConversationSnapshot } from '../messages/contract.js';
import type { ModelSettings } from '../models/contract.js';
import { projectConversation } from './model.js';
import type { AgentRepository } from './repository.js';

const context = BACKGROUND_CONTEXT;

export class Agent {
  private conversation: Promise<Conversation> | undefined;
  private closed = false;
  private submitting = false;

  constructor(
    private readonly harness: Harness,
    private readonly repository: AgentRepository,
  ) {}

  async restore(): Promise<void> {
    const record = await this.repository.latestConversation();
    if (!record) return;

    const conversation = await this.harness.conversation(record.id, context);
    if (conversation) this.conversation = Promise.resolve(conversation);
  }

  async open(model: ModelSettings): Promise<ConversationInfo> {
    this.conversation ??= this.create(model).catch((error: unknown) => {
      this.conversation = undefined;
      throw error;
    });

    return (await this.snapshot()).conversation;
  }

  private create(model: ModelSettings): Promise<Conversation> {
    return this.harness.createConversation(
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
  }

  async snapshot(): Promise<ConversationSnapshot> {
    const conversation = await this.require();
    const watch = await conversation.watch(context);

    try {
      return projectConversation(watch.value);
    } finally {
      await watch.stop();
    }
  }

  async watch(
    listener: (snapshot: ConversationSnapshot) => Promise<void>,
  ): Promise<() => Promise<void>> {
    const conversation = await this.require();
    const watch = await conversation.watch(context);
    await listener(projectConversation(watch.value));
    watch.start(async (view) => listener(projectConversation(view)));

    return async () => {
      await watch.stop();
    };
  }

  async send(text: string, requestId: string, model: ModelSettings): Promise<void> {
    if (this.submitting) throw new Error('A message is being submitted.');

    this.submitting = true;
    try {
      const conversation = await this.require();
      if (!(await this.snapshot()).busy) {
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
      this.submitting = false;
    }
  }

  async stop(): Promise<void> {
    const conversation = await this.require();
    await conversation.abort(context);
  }

  private require(): Promise<Conversation> {
    if (this.conversation === undefined) throw new Error('Open the conversation first.');

    return this.conversation;
  }

  async close(): Promise<void> {
    if (this.closed) return;

    this.closed = true;
    if (this.conversation !== undefined) await this.stop();
    await this.harness.close(context);
  }
}
