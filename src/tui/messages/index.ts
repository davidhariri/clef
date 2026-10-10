import {
  Box,
  Container,
  Markdown,
  SelectList,
  Spacer,
  Text,
  type TUI,
} from '@earendil-works/pi-tui';
import type { ConversationSnapshot } from '../../server/messages/contract.js';
import type { PermissionChoice, PermissionRequest } from '../../server/permissions/contract.js';
import {
  accent,
  danger,
  markdownTheme,
  muted,
  safeText,
  selectTheme,
  userMessageBackground,
} from '../components/theme.js';

export class Transcript extends Container {
  private readonly messages = new Map<
    string,
    {
      block: Container;
      body: Markdown;
    }
  >();

  update(snapshot: ConversationSnapshot) {
    this.clear();
    for (const message of snapshot.messages) {
      let item = this.messages.get(message.id);
      if (!item) {
        const block = new Container();
        if (message.error) block.addChild(new Text(danger('Error'), 1, 0));
        else if (message.role === 'tool') block.addChild(new Text(muted('Tool'), 1, 0));
        const body = new Markdown('', 1, 0, markdownTheme);
        if (message.role === 'user') {
          const filled = new Box(0, 1, userMessageBackground);
          filled.addChild(body);
          block.addChild(filled);
        } else {
          block.addChild(body);
        }
        block.addChild(new Spacer(1));
        item = {
          block,
          body,
        };
        this.messages.set(message.id, item);
      }
      item.body.setText(safeText(message.text));
      this.addChild(item.block);
    }
  }
}

function fileScope(
  request: Extract<
    PermissionRequest,
    {
      kind: 'file';
    }
  >,
): string {
  const action = `Action: ${request.operation}\nFile path: ${request.path}`;
  const provider = 'File contents read can be sent to your model provider.';
  if (request.operation === 'delete')
    return `${action}\nThis approves this file version only. Deletion cannot be undone. Future deletions need approval.\n${provider}`;
  const access =
    request.operation === 'read' || request.operation === 'list' ? 'Read only' : 'Read and write';
  const size = request.bytes === undefined ? '' : `\nWrite size: ${request.bytes} bytes`;

  return `${action}${size}\nDirectory: ${request.directory}\n${access}, including subdirectories.\nThis time permits only this action. Always saves this directory access. Never blocks this directory, except for more-specific rules.\n${provider}`;
}

function scope(request: PermissionRequest): string {
  if ('kind' in request && request.kind === 'file') return fileScope(request);
  if ('kind' in request)
    return `Change model to ${request.defaults.provider}/${request.defaults.modelId}\nThinking: ${request.defaults.thinkingLevel}\n${request.switchConversation ? 'Switch this conversation and save defaults.' : 'Save defaults for the next message.'}\nConversation: ${request.conversationId}\nAlways and Never apply only to this exact model, thinking level, conversation, and switch choice.`;
  return `${request.method} ${request.url}\nSaved rule: ${request.method} ${request.origin}`;
}

export class Approval extends Container {
  private id: string | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly decide: (id: string, choice: PermissionChoice) => void,
    private readonly restore: () => void,
  ) {
    super();
  }

  update(request: PermissionRequest | undefined) {
    if (request?.id === this.id) return;
    this.id = request?.id;
    this.clear();
    if (!request) {
      this.restore();
      return;
    }
    const deleting = 'kind' in request && request.kind === 'file' && request.operation === 'delete';
    this.addChild(new Text(accent(deleting ? 'Delete this file?' : 'Approval required'), 1, 0));
    this.addChild(new Text(safeText(scope(request)), 1, 0));
    const choices: {
      value: PermissionChoice;
      label: string;
    }[] = [
      {
        value: 'deny',
        label: 'Deny',
      },
      {
        value: 'once',
        label: 'This time',
      },
      {
        value: 'always',
        label: 'Always',
      },
      {
        value: 'never',
        label: 'Never',
      },
    ];
    const offered = deleting
      ? choices.filter((choice) => choice.value === 'deny' || choice.value === 'once')
      : choices;
    const list = new SelectList(offered, 4, selectTheme);
    list.onSelect = (item) => {
      const choice = choices.find((entry) => entry.value === item.value);
      if (choice) this.decide(request.id, choice.value);
    };
    list.onCancel = () => this.decide(request.id, 'deny');
    this.addChild(list);
    this.tui.setFocus(list);
  }
}
