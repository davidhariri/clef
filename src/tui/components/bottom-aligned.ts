import type { Component } from '@earendil-works/pi-tui';

export class BottomAligned implements Component {
  constructor(
    private readonly header: Component,
    private readonly content: Component[],
    private readonly height: () => number,
  ) {}

  render(width: number): string[] {
    const header = this.header.render(width);
    const content = this.content.flatMap((component) => component.render(width));
    const space = Array<string>(Math.max(0, this.height() - header.length - content.length)).fill(
      '',
    );

    return [
      ...header,
      ...space,
      ...content,
    ];
  }

  invalidate() {
    this.header.invalidate();
    for (const component of this.content) component.invalidate();
  }
}
