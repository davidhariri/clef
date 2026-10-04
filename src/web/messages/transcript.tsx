import type { ConversationSnapshot } from '../../server/messages/contract.js';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '../components/upstream/ai-elements/conversation.js';
import { Spinner } from '../components/upstream/shadcn-ui/components/ui/spinner.js';
import { Response } from './response.js';

export function Transcript({ snapshot }: { snapshot: ConversationSnapshot | undefined }) {
  return (
    <Conversation aria-label="Conversation" className="min-h-0">
      <ConversationContent className="mx-auto w-full max-w-3xl">
        {!snapshot?.messages.length && (
          <ConversationEmptyState>
            <h1 className="text-xl font-medium">What’s on your mind?</h1>
          </ConversationEmptyState>
        )}
        {snapshot?.messages.map((message, index) => (
          <Response
            key={message.id}
            message={message}
            streaming={
              snapshot.busy &&
              index === snapshot.messages.length - 1 &&
              message.role === 'assistant'
            }
          />
        ))}
        {snapshot?.busy && (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner aria-hidden="true" />
            Clef is thinking…
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton aria-label="Scroll to latest message" />
    </Conversation>
  );
}
