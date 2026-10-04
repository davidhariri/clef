import { PlusIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ConversationInfo } from '../../server/messages/contract.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';

export function Sidebar({
  conversations,
  selected,
  select,
  create,
  creating,
  children,
}: {
  conversations: ConversationInfo[];
  selected: string;
  select: (id: string) => void;
  create: () => void;
  creating: boolean;
  children: ReactNode;
}) {
  return (
    <aside className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-muted/30 p-3 sm:w-60 sm:flex-col sm:items-stretch sm:border-r sm:border-b-0">
      <span className="text-lg font-semibold">Clef</span>
      <Button type="button" variant="outline" onClick={create} disabled={creating}>
        <PlusIcon />
        New conversation
      </Button>
      <nav
        aria-label="Conversations"
        className="order-last flex w-full gap-1 overflow-auto sm:order-none sm:flex-1 sm:flex-col"
      >
        {conversations.map((conversation) => (
          <Button
            type="button"
            key={conversation.id}
            variant={conversation.id === selected ? 'secondary' : 'ghost'}
            aria-current={conversation.id === selected ? 'page' : undefined}
            aria-label={`Open ${conversation.title}`}
            className="shrink-0 justify-start sm:w-full"
            onClick={() => select(conversation.id)}
          >
            <span className="truncate">{conversation.title}</span>
          </Button>
        ))}
      </nav>
      {children}
    </aside>
  );
}
