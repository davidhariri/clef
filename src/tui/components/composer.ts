import { Editor, Loader, type TUI, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { accent, muted, selectTheme } from './theme.js';

class WorkingIndicator extends Loader {
  override render(width: number): string[] {
    return [
      truncateToWidth(`${this.getRenderedIndicator()} ${accent('Working')}`, width, ''),
    ];
  }
}

export class Composer extends Editor {
  private readonly indicator: WorkingIndicator;
  private working = false;

  constructor(tui: TUI) {
    super(
      tui,
      {
        borderColor: muted,
        selectList: selectTheme,
      },
      {
        paddingX: 1,
      },
    );
    this.indicator = new WorkingIndicator(tui, accent, accent, 'Working');
    this.indicator.stop();
  }

  setWorking(working: boolean) {
    if (working === this.working) return;
    this.working = working;
    if (working) this.indicator.start();
    else this.indicator.stop();
    this.tui.requestRender();
  }

  protected override renderTopBorder(width: number, hiddenLineCount: number): string {
    if (!this.working) return super.renderTopBorder(width, hiddenLineCount);
    const overflow = hiddenLineCount > 0 ? `↑ ${hiddenLineCount} more ` : '';
    const status = this.indicator.render(Math.max(0, width - 4 - visibleWidth(overflow)))[0] ?? '';
    const prefix = this.borderColor('── ') + status + this.borderColor(` ${overflow}`);
    const remaining = Math.max(0, width - visibleWidth(prefix));

    return truncateToWidth(prefix, width, '') + this.borderColor('─'.repeat(remaining));
  }
}
