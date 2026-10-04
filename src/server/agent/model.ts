import type { Message } from '@earendil-works/pi-ai';
import type { AgentState, ConversationView, LiveState } from '@earendil-works/pi-durable';
import type { ChatMessage, ConversationSnapshot } from '../messages/contract.js';

function displayMessage(message: Message, id: string, pending = false): ChatMessage | undefined {
  if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult')
    return undefined;
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n');
  const error = message.role === 'assistant' && message.stopReason === 'error';
  return {
    id,
    role: message.role === 'toolResult' ? 'tool' : message.role,
    text: error
      ? 'The model request failed. Check your connection, model access, and provider settings.'
      : text,
    error,
    pending,
  };
}

export function projectConversation(view: ConversationView): ConversationSnapshot {
  const agent = view.docs['pi.agent'] as AgentState | undefined;
  const live = view.docs['pi.live'] as LiveState | undefined;
  if (!agent?.model) throw new Error('Conversation has no model.');
  const messages: ChatMessage[] = [];
  for (const entry of view.entries) {
    for (const [index, message] of (entry.model ?? []).entries()) {
      const item = displayMessage(message, `${entry.id}:${index}`);
      if (item) messages.push(item);
    }
  }
  if (live?.generation?.message) {
    const item = displayMessage(live.generation.message, 'streaming', true);
    if (item?.text) messages.push(item);
  }
  const title =
    messages.find((message) => message.role === 'user')?.text.slice(0, 60) ?? 'New conversation';
  return {
    conversation: {
      id: String(view.conversation.id),
      title,
      model: {
        ...agent.model,
        thinkingLevel: agent.thinkingLevel ?? 'off',
      },
    },
    messages,
    busy: live?.run !== undefined,
    permissions: [],
  };
}
