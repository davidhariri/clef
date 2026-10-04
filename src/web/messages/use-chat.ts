import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../../client/api.js';
import { okSchema } from '../../server/accounts/contract.js';
import {
  type ConversationInfo,
  type ConversationSnapshot,
  conversationSchema,
  snapshotSchema,
} from '../../server/messages/contract.js';
import { useAction } from '../platform/action.js';

export function useChat() {
  const [conversations, setConversations] = useState<ConversationInfo[]>([]);
  const [id, setId] = useState('');
  const [snapshot, setSnapshot] = useState<ConversationSnapshot>();
  const [connected, setConnected] = useState(false);
  const pending = useRef<
    | {
        text: string;
        requestId: string;
      }
    | undefined
  >(undefined);
  const action = useAction();
  const { setError } = action;

  const select = useCallback((next: string) => {
    setId(next);
    history.replaceState(null, '', `/#chat=${encodeURIComponent(next)}`);
  }, []);

  async function create() {
    const conversation = await request('/api/conversations', conversationSchema, {
      body: {},
    });

    setConversations((items) => [
      conversation,
      ...items,
    ]);
    select(conversation.id);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      const items = await request('/api/conversations', conversationSchema.array());
      if (!active) return;

      setConversations(items);
      const saved = new URLSearchParams(location.hash.slice(1)).get('chat');
      const first = items.find((item) => item.id === saved) ?? items[0];
      if (first) {
        select(first.id);
        return;
      }

      const conversation = await request('/api/conversations', conversationSchema, {
        body: {},
      });
      if (!active) return;

      setConversations([
        conversation,
      ]);
      select(conversation.id);
    }

    void load().catch(() => {
      if (active) setError('Cannot load conversations. Reload to try again.');
    });

    return () => {
      active = false;
    };
  }, [
    setError,
    select,
  ]);

  useEffect(() => {
    if (!id) return;

    setSnapshot(undefined);
    setConnected(false);
    pending.current = undefined;

    const events = new EventSource(`/api/conversations/${encodeURIComponent(id)}/events`);
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.addEventListener('snapshot', (event: MessageEvent<string>) => {
      try {
        const next = snapshotSchema.parse(JSON.parse(event.data));
        setSnapshot(next);
        setConversations((items) =>
          items.map((item) => (item.id === next.conversation.id ? next.conversation : item)),
        );
      } catch {
        setError('The conversation update could not be read. Reload to reconnect.');
        events.close();
      }
    });

    return () => events.close();
  }, [
    id,
    setError,
  ]);

  async function send(text: string) {
    if (!snapshot || !connected || snapshot.busy)
      throw new Error('Wait for the conversation to be ready.');

    const submitted =
      pending.current?.text === text
        ? pending.current
        : {
            text,
            requestId: crypto.randomUUID(),
          };
    pending.current = submitted;

    await request(`/api/conversations/${id}/messages`, okSchema, {
      body: submitted,
    });
    pending.current = undefined;
  }

  async function stop() {
    await request(`/api/conversations/${id}/stop`, okSchema, {
      body: {},
    });
  }

  return {
    conversations,
    id,
    connected,
    select,
    send,
    stop,
    snapshot: snapshot?.conversation.id === id ? snapshot : undefined,
    error: action.error,
    creating: action.busy,
    create: () => action.run(create),
  };
}
