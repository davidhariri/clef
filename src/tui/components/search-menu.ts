import {
  type Component,
  type Focusable,
  fuzzyFilter,
  Input,
  matchesKey,
  type SelectItem,
  SelectList,
  Text,
  type TUI,
} from '@earendil-works/pi-tui';
import { danger, muted, safeText, selectTheme } from './theme.js';

export type MenuItems =
  | SelectItem[]
  | ((query: string, signal: AbortSignal) => Promise<SelectItem[]>);

export class SearchMenu implements Component, Focusable {
  private readonly input = new Input({
    prompt: 'Search: ',
  });
  private readonly closed = new AbortController();
  private request = new AbortController();
  private items: SelectItem[] = [];
  private visible = 6;
  private list = new SelectList([], this.visible, selectTheme);
  private active = false;
  private selecting = true;
  private pending = false;
  private error = '';
  onSelect: ((item: SelectItem) => void) | undefined;
  onCancel: (() => void) | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly source: MenuItems,
    query = '',
  ) {
    this.input.setValue(query);
    void this.search();
  }

  get focused() {
    return this.active;
  }
  set focused(value: boolean) {
    this.active = value;
    this.input.focused = value && !this.selecting;
  }

  private replace(items: SelectItem[], selected = 0) {
    this.items = items.map((item) => ({
      ...item,
      label: safeText(item.label),
      ...(item.description
        ? {
            description: safeText(item.description),
          }
        : {}),
    }));
    this.list = new SelectList(this.items, this.visible, selectTheme);
    this.list.setSelectedIndex(selected);
    this.list.onSelect = (item) => this.onSelect?.(item);
  }

  private async search() {
    this.request.abort();
    this.request = new AbortController();
    const signal = AbortSignal.any([
      this.closed.signal,
      this.request.signal,
    ]);
    this.pending = true;
    this.error = '';
    try {
      const query = this.input.getValue();
      const items =
        typeof this.source === 'function'
          ? await this.source(query, signal)
          : fuzzyFilter(this.source, query, (item) => `${item.label} ${item.description ?? ''}`);
      if (!signal.aborted) this.replace(items);
    } catch (error) {
      if (!signal.aborted) {
        this.replace([]);
        this.error = safeText(error instanceof Error ? error.message : 'Search failed.');
      }
    } finally {
      if (!signal.aborted) {
        this.pending = false;
        this.tui.requestRender();
      }
    }
  }

  handleInput(data: string) {
    if (matchesKey(data, 'escape')) return this.onCancel?.();
    if (matchesKey(data, 'enter') || (data === ' ' && this.selecting)) {
      if (!this.pending) this.list.handleInput('\r');
      return;
    }
    if (matchesKey(data, 'up') || matchesKey(data, 'down')) {
      this.selecting = true;
      this.list.handleInput(data);
    } else if (matchesKey(data, 'tab')) {
      this.selecting = !this.selecting;
    } else {
      this.selecting = false;
      const before = this.input.getValue();
      this.input.handleInput(data);
      if (before !== this.input.getValue()) void this.search();
    }
    this.input.focused = this.active && !this.selecting;
  }

  render(width: number): string[] {
    const visible = Math.max(1, Math.min(6, this.tui.terminal.rows - 12));
    if (visible !== this.visible) {
      const selected = this.list.getSelectedItem()?.value;
      this.visible = visible;
      this.replace(
        this.items,
        Math.max(
          0,
          this.items.findIndex((item) => item.value === selected),
        ),
      );
    }
    const content = this.pending
      ? new Text(muted('Searching…'), 0, 0).render(width)
      : this.error
        ? new Text(danger(this.error), 0, 0).render(width)
        : this.list.render(width);
    return [
      ...this.input.render(width),
      '',
      ...content,
    ];
  }

  invalidate() {
    this.input.invalidate();
    this.list.invalidate();
  }

  close() {
    this.closed.abort();
  }
}
