import { Settings } from '../settings/index.js';
import { Composer } from './composer.js';
import { Sidebar } from './sidebar.js';
import { Transcript } from './transcript.js';
import { useChat } from './use-chat.js';

export function Chat({ refresh }: { refresh: () => Promise<void> }) {
  const chat = useChat();

  return (
    <div className="flex h-svh flex-col overflow-hidden sm:flex-row">
      <Sidebar
        conversations={chat.conversations}
        selected={chat.id}
        select={chat.select}
        create={chat.create}
        creating={chat.creating}
      >
        <Settings refresh={refresh} />
      </Sidebar>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex justify-between gap-4 border-b px-4 py-3 text-sm text-muted-foreground">
          <span>{chat.snapshot?.conversation.model.modelId ?? 'Loading…'}</span>
          <span>{chat.connected ? 'Connected' : 'Reconnecting…'}</span>
        </header>
        {chat.error && (
          <p role="alert" className="p-4 text-sm text-destructive">
            {chat.error}
          </p>
        )}
        <Transcript key={`transcript:${chat.id}`} snapshot={chat.snapshot} />
        {chat.id && (
          <Composer
            key={`composer:${chat.id}`}
            ready={chat.connected && Boolean(chat.snapshot)}
            generating={chat.snapshot?.busy ?? false}
            send={chat.send}
            stop={chat.stop}
          />
        )}
      </main>
    </div>
  );
}
