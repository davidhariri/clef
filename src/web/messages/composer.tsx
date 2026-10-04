import { useState } from 'react';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '../components/upstream/ai-elements/prompt-input.js';
import { useAction } from '../platform/action.js';

export function Composer({
  ready,
  generating,
  send,
  stop,
}: {
  ready: boolean;
  generating: boolean;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const action = useAction();

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-3 p-4">
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
      <PromptInput
        maxFiles={0}
        onError={() => action.setError('Attachments are not supported yet. Send text only.')}
        onSubmit={(message) => {
          if (!message.text.trim() || action.busy || generating || !ready) return;

          action.run(async () => {
            await send(message.text);
            setText((current) => (current === message.text ? '' : current));
          });
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="Message"
            placeholder="Message Clef…"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && (generating || action.busy || !ready))
                event.preventDefault();
            }}
          />
        </PromptInputBody>
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit
            aria-label={generating ? 'Stop reply' : 'Send message'}
            status={generating ? 'streaming' : 'ready'}
            onStop={() => action.run(stop)}
            disabled={action.busy || (!generating && (!text.trim() || !ready))}
          />
        </PromptInputFooter>
      </PromptInput>
      <p className="text-center text-xs text-muted-foreground">
        Your chosen model receives this conversation. Configuration changes require approval.
        Scripts, shell and file access are disabled.
      </p>
    </div>
  );
}
