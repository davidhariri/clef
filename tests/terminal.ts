import type { Terminal } from '@earendil-works/pi-tui';
import xterm from '@xterm/headless';

export class TestTerminal implements Terminal {
  readonly screen = new xterm.Terminal({
    cols: 90,
    rows: 30,
    allowProposedApi: true,
    scrollback: 10000,
  });
  private onInput: ((data: string) => void) | undefined;
  private onResize: (() => void) | undefined;
  output = '';
  stopped = false;
  readonly kittyProtocolActive = false;

  get columns() {
    return this.screen.cols;
  }
  get rows() {
    return this.screen.rows;
  }

  start(onInput: (data: string) => void, onResize: () => void) {
    this.onInput = onInput;
    this.onResize = onResize;
  }

  stop() {
    this.stopped = true;
  }
  async drainInput() {}
  input(data: string) {
    this.onInput?.(data);
  }
  type(text: string) {
    this.input(`\u001b[200~${text}\u001b[201~`);
  }
  resize(columns: number, rows: number) {
    this.screen.resize(columns, rows);
    this.onResize?.();
  }
  write(data: string) {
    this.output += data;
    this.screen.write(data);
  }
  moveBy(lines: number) {
    this.write(`\u001b[${Math.abs(lines)}${lines < 0 ? 'A' : 'B'}`);
  }
  hideCursor() {
    this.write('\u001b[?25l');
  }
  showCursor() {
    this.write('\u001b[?25h');
  }
  clearLine() {
    this.write('\u001b[2K');
  }
  clearFromCursor() {
    this.write('\u001b[J');
  }
  clearScreen() {
    this.write('\u001b[2J\u001b[H');
  }
  setTitle(_title: string) {}
  setProgress(_active: boolean) {}
  visibleLines() {
    const buffer = this.screen.buffer.active;
    return Array.from(
      {
        length: this.rows,
      },
      (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '',
    );
  }
  text() {
    const buffer = this.screen.buffer.active;
    return Array.from(
      {
        length: buffer.length,
      },
      (_, index) => buffer.getLine(index)?.translateToString(true) ?? '',
    ).join('\n');
  }
}
