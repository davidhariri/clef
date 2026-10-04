import { useEffect, useRef, useState } from 'react';
import { request } from '../../client/api.js';
import { okSchema } from '../../server/accounts/contract.js';
import { type ConversationSnapshot, snapshotSchema } from '../../server/messages/contract.js';

export function useChat() {
  const [snapshot, setSnapshot] = useState<ConversationSnapshot>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<
    | {
        text: string;
        requestId: string;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    const events = new EventSource('/api/conversation/events');
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.addEventListener('snapshot', (event: MessageEvent<string>) => {
      try {
        setSnapshot(snapshotSchema.parse(JSON.parse(event.data)));
      } catch {
        setError('The conversation update could not be read. Reload to reconnect.');
        events.close();
        setConnected(false);
      }
    });

    return () => events.close();
  }, []);

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

    await request('/api/conversation/messages', okSchema, {
      body: submitted,
    });
    pending.current = undefined;
  }

  async function stop() {
    await request('/api/conversation/stop', okSchema, {
      body: {},
    });
  }

  return {
    connected,
    send,
    stop,
    snapshot,
    error,
  };
}
