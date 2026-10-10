import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { matchesKey, type Terminal, Text, TuiMainScreen } from '@earendil-works/pi-tui';
import type { ClefClient } from '../client/index.js';
import { okSchema, statusSchema } from '../server/access/contract.js';
import {
  type ConversationSnapshot,
  conversationSchema,
  snapshotSchema,
} from '../server/messages/contract.js';
import type { PermissionChoice } from '../server/permissions/contract.js';
import { type Command, commandSuggestions } from './commands.js';
import { BottomAligned } from './components/bottom-aligned.js';
import { Composer } from './components/composer.js';
import { Dialogs } from './components/dialogs.js';
import { danger, muted, safeText } from './components/theme.js';
import { chooseConversation, conversationItems } from './conversations/index.js';
import { clefName } from './identity.js';
import { Approval, Transcript } from './messages/index.js';
import { settings } from './settings/index.js';

class Chat {
  private readonly tui: TuiMainScreen;
  private readonly editor: Composer;
  private readonly commands: Command[];
  private readonly transcript = new Transcript();
  private readonly header = new Text('', 1, 1);
  private selectedId: string | undefined;
  private streamStop: AbortController | undefined;
  private commandSelected = false;
  private readonly footer = new Text('', 1, 0);
  private readonly error = new Text('', 1, 0);
  private readonly approval: Approval;
  private readonly dialogs: Dialogs;
  private readonly stop = new AbortController();
  private snapshot: ConversationSnapshot | undefined;
  private connected = false;
  private configuring = false;
  private sending = false;
  private pending:
    | {
        text: string;
        requestId: string;
      }
    | undefined;
  private watching: Promise<void> | undefined;

  constructor(
    private readonly client: ClefClient,
    terminal: Terminal,
  ) {
    this.stop.signal.addEventListener('abort', () => this.client.close(), {
      once: true,
    });
    this.tui = new TuiMainScreen(terminal);
    this.editor = new Composer(this.tui);
    this.commands = [
      {
        name: 'new',
        description: 'Start a new main conversation',
        run: async () => {
          await this.client.request('/api/conversations', conversationSchema, {});
          await this.select();
        },
      },
      {
        name: 'switch',
        description: 'Search conversations',
        run: (query) => this.switchConversation(query),
        suggest: async (query, signal) =>
          (await conversationItems(this.client, query, signal)).map((item) => ({
            ...item,
            value: `switch ${item.value}`,
          })),
      },
      {
        name: 'settings',
        description: 'Configure server',
        run: () => this.configure(),
      },
      {
        name: 'stop',
        description: 'Stop the current reply',
        run: async () => {
          await this.client.request(this.path('/stop'), okSchema, {});
        },
      },
      {
        name: 'exit',
        description: 'Exit chat; keep server running',
        run: async () => this.stop.abort(),
      },
    ];
    this.editor.setAutocompleteProvider(commandSuggestions(this.commands));
    this.editor.onChange = () => {
      this.commandSelected = false;
    };
    this.dialogs = new Dialogs(this.tui, this.stop.signal);
    this.approval = new Approval(
      this.tui,
      (id, choice) => this.perform(this.decide(id, choice)),
      () => this.tui.setFocus(this.editor),
    );
    this.tui.addChild(
      new BottomAligned(
        this.header,
        [
          this.transcript,
          this.approval,
          this.error,
          this.editor,
          this.footer,
        ],
        () => this.tui.terminal.rows,
      ),
    );
    this.tui.setFocus(this.editor);
    this.editor.onSubmit = (text) => this.perform(this.submit(text));
    this.tui.addInputListener((data) => this.input(data));
  }

  private path(suffix = '', id = this.snapshot?.conversation.id ?? this.selectedId) {
    return `/api/conversation${suffix}${id ? `?id=${encodeURIComponent(id)}` : ''}`;
  }

  private async select(id?: string) {
    const path = `/api/conversation${id ? `?id=${encodeURIComponent(id)}` : ''}`;
    const snapshot = await this.client.request(path, snapshotSchema);
    this.streamStop?.abort();
    await this.watching;
    this.selectedId = id;
    this.pending = undefined;
    this.connected = false;
    this.update(snapshot);
    this.watch();
  }

  private async switchConversation(query: string) {
    this.configuring = true;
    try {
      const selection = await chooseConversation(this.client, this.dialogs, query);
      if (selection) await this.select(selection.id);
    } finally {
      this.configuring = false;
      this.tui.setFocus(this.editor);
      this.approval.update(this.snapshot?.permissions[0]);
      this.tui.requestRender();
    }
  }

  private input(data: string) {
    if (matchesKey(data, 'ctrl+d')) {
      this.stop.abort();
      return {
        consume: true,
      };
    }
    if (matchesKey(data, 'ctrl+c')) {
      if (this.snapshot?.busy) this.perform(this.client.request(this.path('/stop'), okSchema, {}));
      else if (this.editor.getText()) this.editor.setText('');
      else this.stop.abort();
      return {
        consume: true,
      };
    }
    if (
      !this.configuring &&
      (matchesKey(data, 'up') || matchesKey(data, 'down')) &&
      this.editor.isShowingAutocomplete()
    )
      this.commandSelected = true;
    if (
      data === ' ' &&
      !this.configuring &&
      this.editor.isShowingAutocomplete() &&
      (!this.editor.getText().startsWith('/switch') || this.commandSelected)
    ) {
      this.editor.handleInput('\r');
      return {
        consume: true,
      };
    }
    if (
      matchesKey(data, 'escape') &&
      !this.configuring &&
      !this.editor.isShowingAutocomplete() &&
      this.snapshot?.busy
    ) {
      this.perform(this.client.request(this.path('/stop'), okSchema, {}));
      return {
        consume: true,
      };
    }
    return undefined;
  }

  private perform(task: Promise<unknown>) {
    void task.catch((error: unknown) => {
      if (this.stop.signal.aborted) return;
      this.error.setText(
        danger(safeText(error instanceof Error ? error.message : 'The operation failed.')),
      );
      this.tui.requestRender();
    });
  }

  private update(snapshot: ConversationSnapshot) {
    this.snapshot = snapshot;
    this.transcript.update(snapshot);
    if (!this.configuring) this.approval.update(snapshot.permissions[0]);
    this.status();
  }

  private status() {
    const model = this.snapshot?.conversation.model;
    const waiting = Boolean(this.snapshot?.permissions.length);
    const working =
      this.connected &&
      (this.sending || Boolean(this.snapshot?.busy)) &&
      !waiting &&
      !this.stop.signal.aborted;
    this.editor.setWorking(working);
    const state = !this.connected
      ? 'Connecting'
      : waiting
        ? 'Approval required · Esc Stop'
        : working
          ? 'Esc Stop'
          : 'Ready';
    const title =
      this.selectedId === undefined
        ? '✦ Main'
        : this.snapshot?.messages
            .find((message) => message.role === 'user')
            ?.text.split('\n', 1)[0]
            ?.slice(0, 120) || 'Conversation';
    const modelLabel = model ? ` · ${safeText(model.modelId)} · ${model.thinkingLevel}` : '';
    this.header.setText(
      muted(`${clefName} · ${safeText(this.client.url)} · ${safeText(title)}${modelLabel}`),
    );
    this.footer.setText(muted(`${state}\n/ Commands  Alt+Enter New line  Ctrl+D Exit`));
    this.tui.requestRender();
  }

  private watch() {
    if (this.watching !== undefined) return;
    this.streamStop = new AbortController();
    this.watching = this.client
      .watch(
        AbortSignal.any([
          this.stop.signal,
          this.streamStop.signal,
        ]),
        (snapshot) => this.update(snapshot),
        (error) => {
          this.connected = !error;
          this.error.setText(error ? danger(safeText(error.message)) : '');
          this.status();
        },
        this.selectedId,
      )
      .finally(() => {
        this.watching = undefined;
      });
  }

  private async configure() {
    this.configuring = true;
    try {
      await settings(this.client, this.dialogs, this.stop.signal);
      if (this.stop.signal.aborted) return;
      const status = await this.client.request('/api/status', statusSchema);
      if (status.phase === 'ready') this.watch();
    } finally {
      this.configuring = false;
      this.tui.setFocus(this.editor);
      this.approval.update(this.snapshot?.permissions[0]);
      this.tui.requestRender();
    }
  }

  private async decide(id: string, choice: PermissionChoice) {
    await this.client.request(this.path(`/permissions/${id}`), okSchema, {
      choice,
    });
  }

  private async submit(text: string) {
    if (!text.trim()) return;
    this.error.setText('');
    const [name, ...arguments_] = text.trim().split(/\s+/);
    const command = this.commands.find((command) => name === `/${command.name}`);
    if (command) {
      if (arguments_.length && !command.suggest)
        throw new Error(`/${command.name} does not take arguments.`);
      return command.run(arguments_.join(' '));
    }
    if (text.startsWith('/'))
      throw new Error(`Commands: ${this.commands.map((command) => `/${command.name}`).join(', ')}`);
    if (!this.connected || !this.snapshot || this.snapshot.busy || this.sending) {
      this.editor.setText(text);
      throw new Error('Wait for the conversation to be ready.');
    }
    this.sending = true;
    this.status();
    const submitted =
      this.pending?.text === text
        ? this.pending
        : {
            text,
            requestId: randomUUID(),
          };
    this.pending = submitted;
    try {
      await this.client.request(this.path('/messages'), okSchema, submitted);
      this.pending = undefined;
      this.editor.addToHistory(text);
    } catch (error) {
      this.editor.setText(text);
      throw error;
    } finally {
      this.sending = false;
      this.status();
    }
  }

  async run(signal: AbortSignal) {
    const abort = () => this.stop.abort();
    signal.addEventListener('abort', abort, {
      once: true,
    });
    if (signal.aborted) abort();
    this.tui.start();
    try {
      this.status();
      const status = await this.client.request('/api/status', statusSchema);
      if (status.phase === 'ready') this.watch();
      else this.perform(this.configure());
      if (!this.stop.signal.aborted) await once(this.stop.signal, 'abort');
    } catch (error) {
      if (!this.stop.signal.aborted) throw error;
    } finally {
      this.stop.abort();
      await this.watching;
      signal.removeEventListener('abort', abort);
      this.editor.setWorking(false);
      this.tui.stop();
      await this.tui.terminal.drainInput();
    }
  }
}

export async function runTui(client: ClefClient, terminal: Terminal, signal: AbortSignal) {
  await new Chat(client, terminal).run(signal);
}
