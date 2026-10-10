import {
  type Component,
  Container,
  type Focusable,
  Input,
  isFocusable,
  Spacer,
  Text,
  type TUI,
  truncateToWidth,
} from '@earendil-works/pi-tui';
import { type MenuItems, SearchMenu } from './search-menu.js';
import { bold, muted, safeText } from './theme.js';

class Panel extends Container implements Focusable {
  constructor(
    title: string,
    detail: string,
    private readonly control: Component,
    private readonly height: () => number,
    hint: string,
  ) {
    super();
    this.addChild(new Text(bold(safeText(title)), 1, 1));
    if (detail) this.addChild(new Text(safeText(detail), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(control);
    this.addChild(new Text(muted(hint), 1, 1));
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    return [
      ...lines,
      ...Array<string>(Math.max(0, this.height() - lines.length)).fill(' '.repeat(width)),
    ];
  }

  get focused() {
    return isFocusable(this.control) && this.control.focused;
  }
  set focused(value: boolean) {
    if (isFocusable(this.control)) this.control.focused = value;
  }
  handleInput(data: string) {
    this.control.handleInput?.(data);
  }
}

class SecretInput extends Input {
  override render(width: number): string[] {
    return [
      truncateToWidth(`› ${'•'.repeat(Math.min(this.getValue().length, 32))}▏`, width),
    ];
  }
}

export class Dialogs {
  constructor(
    private readonly tui: TUI,
    private readonly signal: AbortSignal,
  ) {}

  private show<T>(
    title: string,
    detail: string,
    control: Component,
    bind: (finish: (value: T | undefined) => void) => void,
    hint = 'Type to search · ↑↓ Move · Enter/Space Select · Tab Search · Esc Back',
  ): Promise<T | undefined> {
    if (this.signal.aborted) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const panel = new Panel(title, detail, control, () => this.tui.terminal.rows, hint);
      const overlay = this.tui.showOverlay(panel, {
        width: '100%',
        maxHeight: '100%',
        margin: 0,
        row: 0,
        col: 0,
      });
      const finish = (value: T | undefined) => {
        this.signal.removeEventListener('abort', cancel);
        overlay.hide();
        resolve(value);
      };
      const cancel = () => finish(undefined);
      this.signal.addEventListener('abort', cancel, {
        once: true,
      });
      bind(finish);
      this.tui.requestRender();
    });
  }

  async choose(
    title: string,
    items: MenuItems,
    detail = '',
    query = '',
  ): Promise<string | undefined> {
    const menu = new SearchMenu(this.tui, items, query);
    try {
      return await this.show<string>(title, detail, menu, (finish) => {
        menu.onSelect = (item) => finish(item.value);
        menu.onCancel = () => finish(undefined);
      });
    } finally {
      menu.close();
    }
  }

  input(
    title: string,
    options: {
      value?: string;
      secret?: boolean;
      detail?: string;
    } = {},
  ): Promise<string | undefined> {
    const input = options.secret ? new SecretInput() : new Input();
    input.setValue(options.value ?? '');
    return this.show<string>(
      title,
      options.detail ?? '',
      input,
      (finish) => {
        input.onSubmit = (value) => finish(value.trim());
        input.onEscape = () => finish(undefined);
      },
      'Enter Confirm · Esc Back',
    );
  }
}
