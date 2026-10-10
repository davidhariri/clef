import type { Message } from '@earendil-works/pi-ai';
import type {
  AgentState,
  ConversationView,
  EntryRecord,
  LiveState,
  SubmissionRecord,
} from '@earendil-works/pi-durable';
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

function failureMessage(id: string, reason: string): ChatMessage {
  return {
    id: `failure:${id}`,
    role: 'assistant',
    text:
      reason === 'no_model'
        ? 'The selected model is unavailable. Check its connection or choose an installed model in Settings, then send your message again.'
        : 'The reply failed before completion. Check your connection and provider settings, then try again.',
    error: true,
    pending: false,
  };
}

function projectMessages(
  entries: readonly EntryRecord[],
  submissions: readonly SubmissionRecord[],
): ChatMessage[] {
  const failures = new Map(
    submissions.flatMap((submission) =>
      submission.type === 'input' &&
      submission.status === 'unanswered' &&
      submission.entry !== undefined &&
      ![
        'aborted',
        'reset',
      ].includes(submission.reason)
        ? [
            [
              submission.entry,
              failureMessage(String(submission.id), submission.reason),
            ] as const,
          ]
        : [],
    ),
  );
  const messages: ChatMessage[] = [];
  let failure: ChatMessage | undefined;
  for (const entry of entries) {
    const items = (entry.model ?? [])
      .map((message, index) => displayMessage(message, `${entry.id}:${index}`))
      .filter((message) => message !== undefined);
    if (failure && items.some((message) => message.role === 'user')) {
      messages.push(failure);
      failure = undefined;
    }
    messages.push(...items);
    if (items.some((message) => message.error)) failure = undefined;
    failure = failures.get(entry.id) ?? failure;
  }
  if (failure) messages.push(failure);

  return messages;
}

export function projectConversation(
  view: ConversationView,
  submissions: readonly SubmissionRecord[],
): ConversationSnapshot {
  const agent = view.docs['pi.agent'] as AgentState | undefined;
  const live = view.docs['pi.live'] as LiveState | undefined;
  if (!agent?.model) throw new Error('Conversation has no model.');
  const messages = projectMessages(view.entries, submissions);
  if (live?.generation?.message) {
    const item = displayMessage(live.generation.message, 'streaming', true);
    if (item?.text) messages.push(item);
  }

  return {
    conversation: {
      id: String(view.conversation.id),
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
