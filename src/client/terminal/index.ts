import {
  CURSOR_MARKER,
  Input,
  matchesKey,
  ProcessTerminal,
  stripTerminalSequences,
  Text,
  TuiMainScreen,
  truncateToWidth,
} from '@earendil-works/pi-tui';
import { okSchema, statusSchema } from '../../server/accounts/contract.js';
import { conversationSchema } from '../../server/messages/contract.js';
import { Connection } from './connection.js';

class PasswordInput extends Input {
  override render(width: number): string[] {
    return [
      truncateToWidth(
        `Password: ${'•'.repeat(this.getValue().length)}`,
        Math.max(0, width - 1),
        '',
      ) +
        CURSOR_MARKER +
        ' ',
    ];
  }
}

export async function runChat(url: string): Promise<void> {
  const connection = new Connection(url);
  const status = await connection.call('/api/status', statusSchema);
  if (status.phase === 'setup') throw new Error('Complete setup in the web app first.');

  const tui = new TuiMainScreen(new ProcessTerminal());
  const title = new Text('Clef', 1, 1);
  const transcript = new Text('', 1, 0);
  const footer = new Text('Sign in to your local server.', 1, 1);
  let input: Input = new Input({
    prompt: 'Username: ',
  });
  let phase: 'username' | 'password' | 'chat' = 'username';
  let username = '';
  let id = '';
  let pending:
    | {
        text: string;
        requestId: string;
      }
    | undefined;
  let working = false;
  let ending = false;
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });

  function fail(error: unknown) {
    footer.setText(
      stripTerminalSequences(error instanceof Error ? error.message : 'The request failed.'),
    );
    tui.requestRender();
  }

  function setInput(next: Input) {
    tui.removeChild(input);
    input = next;
    input.onSubmit = (value) => {
      if (working || ending) return;
      working = true;
      void submit(value)
        .catch(fail)
        .finally(() => {
          working = false;
          tui.requestRender();
        });
    };
    tui.addChild(input);
    tui.setFocus(input);
    tui.requestRender();
  }

  function watch(next: string) {
    id = next;
    connection.watch(
      id,
      (snapshot) => {
        transcript.setText(
          snapshot.messages
            .map(
              (message) =>
                `${message.role === 'user' ? 'You' : 'Clef'}\n${stripTerminalSequences(message.text)}`,
            )
            .join('\n\n'),
        );
        footer.setText(
          snapshot.busy
            ? 'Clef is thinking… /stop to stop'
            : 'Message Clef · /new · /list · /open ID · /quit',
        );
        tui.requestRender();
      },
      () => {
        footer.setText('Reconnecting to Clef…');
        tui.requestRender();
      },
    );
  }

  function quit() {
    if (ending) return;

    ending = true;
    connection.close();
    tui.stop();
    finish();
  }

  async function submit(value: string) {
    if (!value.trim()) return;

    if (phase === 'username') {
      username = value;
      phase = 'password';
      setInput(new PasswordInput());
      return;
    }

    if (phase === 'password') {
      await signIn(value);
      return;
    }

    await chatInput(value);
  }

  async function signIn(password: string) {
    input.setValue('');
    await connection.call('/api/login', okSchema, {
      body: {
        username,
        password,
      },
    });

    const ready = await connection.call('/api/status', statusSchema);
    if (ready.phase !== 'ready')
      throw new Error(
        `Complete provider connection or key recovery at ${url}, then sign in again.`,
      );

    phase = 'chat';
    setInput(
      new Input({
        prompt: '> ',
        placeholder: 'Message Clef',
      }),
    );

    const conversations = await connection.call('/api/conversations', conversationSchema.array());
    const first =
      conversations[0] ??
      (await connection.call('/api/conversations', conversationSchema, {
        body: {},
      }));

    watch(first.id);
  }

  async function chatInput(value: string) {
    if (value === '/quit') {
      quit();
      return;
    }

    if (value === '/stop')
      await connection.call(`/api/conversations/${id}/stop`, okSchema, {
        body: {},
      });
    else if (value === '/new')
      watch(
        (
          await connection.call('/api/conversations', conversationSchema, {
            body: {},
          })
        ).id,
      );
    else if (value === '/list') {
      const items = await connection.call('/api/conversations', conversationSchema.array());
      footer.setText(
        items.map((item) => `${item.id}  ${stripTerminalSequences(item.title)}`).join('\n'),
      );
    } else if (value.startsWith('/open ')) {
      const next = value.slice(6).trim();
      if (
        !(await connection.call('/api/conversations', conversationSchema.array())).some(
          (item) => item.id === next,
        )
      )
        throw new Error('Conversation not found.');
      watch(next);
    } else {
      await sendMessage(value);
    }

    input.setValue('');
  }

  async function sendMessage(text: string) {
    pending =
      pending?.text === text
        ? pending
        : {
            text,
            requestId: crypto.randomUUID(),
          };

    await connection.call(`/api/conversations/${id}/messages`, okSchema, {
      body: pending,
    });
    pending = undefined;
  }

  tui.addChild(title);
  tui.addChild(transcript);
  tui.addChild(footer);
  setInput(input);
  tui.addInputListener((data) => {
    if (matchesKey(data, 'ctrl+c')) {
      quit();
      return {
        consume: true,
      };
    }
    return undefined;
  });
  process.once('SIGTERM', quit);
  tui.start();

  try {
    await done;
  } finally {
    process.off('SIGTERM', quit);
    connection.close();
    tui.stop();
  }
}
