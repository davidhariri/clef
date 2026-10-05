import { Settings } from '../settings/index.js';
import { Approval } from './approval.js';
import { Composer } from './composer.js';
import { Transcript } from './transcript.js';
import { useChat } from './use-chat.js';

export function Chat({ refresh }: { refresh: () => Promise<void> }) {
  const chat = useChat();

  return (
    <main className="flex h-svh min-w-0 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3 text-sm text-muted-foreground">
        <span className="text-lg font-semibold text-foreground">Clef</span>
        <span>{chat.snapshot?.conversation.model.modelId ?? 'Loading…'}</span>
        <span>{chat.connected ? 'Connected' : 'Reconnecting…'}</span>
        <Settings refresh={refresh} />
      </header>
      {chat.error && (
        <p role="alert" className="p-4 text-sm text-destructive">
          {chat.error}
        </p>
      )}
      <Transcript snapshot={chat.snapshot} ready={chat.connected} submit={chat.submit} />
      {chat.snapshot?.permissions.map((approval) => (
        <Approval key={approval.id} approval={approval} />
      ))}
      <Composer
        ready={chat.connected && Boolean(chat.snapshot)}
        generating={chat.snapshot?.busy ?? false}
        send={chat.send}
        stop={chat.stop}
      />
    </main>
  );
}
