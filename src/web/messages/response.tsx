import { CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { defaultRehypePlugins } from 'streamdown';
import type { ConversationSnapshot } from '../../server/messages/contract.js';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
  type MessageResponseProps,
} from '../components/upstream/ai-elements/message.js';
import { useAction } from '../platform/action.js';

const rehypePlugins = Object.entries(defaultRehypePlugins)
  .filter(([name]) => name !== 'raw')
  .map(([, plugin]) => plugin);

const markdownComponents: NonNullable<MessageResponseProps['components']> = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  img: ({ alt, src }) => (
    <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noreferrer">
      {alt || 'Open image'}
    </a>
  ),
};

export function Response({
  message,
  streaming,
}: {
  message: ConversationSnapshot['messages'][number];
  streaming: boolean;
}) {
  const action = useAction();
  const [copied, setCopied] = useState(false);

  return (
    <article aria-label={message.role === 'user' ? 'Your message' : 'Clef reply'}>
      <Message from={message.role === 'user' ? 'user' : 'assistant'}>
        <MessageContent className={message.error ? 'text-destructive' : undefined}>
          <span className="text-xs font-medium text-muted-foreground">
            {message.role === 'user' ? 'You' : 'Clef'}
          </span>
          <MessageResponse
            components={markdownComponents}
            skipHtml
            rehypePlugins={rehypePlugins}
            isAnimating={streaming}
          >
            {message.text}
          </MessageResponse>
        </MessageContent>
        {message.role === 'assistant' && (
          <MessageActions>
            <MessageAction
              label="Copy reply"
              tooltip="Copy reply"
              disabled={streaming || action.busy}
              onClick={() =>
                action.run(async () => {
                  await navigator.clipboard.writeText(message.text);
                  setCopied(true);
                })
              }
            >
              <CopyIcon />
            </MessageAction>
            {copied && (
              <span role="status" className="text-xs text-muted-foreground">
                Copied
              </span>
            )}
          </MessageActions>
        )}
        {action.error && (
          <p role="alert" className="text-sm text-destructive">
            {action.error}
          </p>
        )}
      </Message>
    </article>
  );
}
