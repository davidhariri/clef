import {
  indexedColor,
  type MarkdownTheme,
  type SelectListTheme,
  stripTerminalSequences,
  styleText,
} from '@earendil-works/pi-tui';

export const plain = (text: string) => text;
export const muted = (text: string) =>
  styleText(
    text,
    {
      dim: true,
    },
    '256color',
  );
export const accent = (text: string) =>
  styleText(
    text,
    {
      fg: indexedColor(6),
    },
    '256color',
  );
export const userMessageBackground = (text: string) =>
  styleText(
    text,
    {
      bg: indexedColor(8),
    },
    '256color',
  );
export const bold = (text: string) =>
  styleText(
    text,
    {
      bold: true,
    },
    '256color',
  );
export const danger = (text: string) =>
  styleText(
    text,
    {
      fg: indexedColor(1),
    },
    '256color',
  );

export function safeText(value: string): string {
  return Array.from(stripTerminalSequences(value))
    .filter((character) => {
      const point = character.codePointAt(0) ?? 0;
      return (
        point === 10 ||
        point === 9 ||
        (point >= 32 &&
          !(point >= 127 && point <= 159) &&
          !(point >= 8234 && point <= 8238) &&
          !(point >= 8294 && point <= 8297))
      );
    })
    .join('');
}

export const selectTheme: SelectListTheme = {
  selectedPrefix: accent,
  selectedText: bold,
  description: muted,
  scrollInfo: muted,
  noMatch: muted,
};

export const markdownTheme: MarkdownTheme = {
  heading: bold,
  link: accent,
  linkUrl: muted,
  code: accent,
  codeBlock: plain,
  codeBlockBorder: muted,
  quote: muted,
  quoteBorder: muted,
  hr: muted,
  listBullet: accent,
  bold,
  italic: (text) =>
    styleText(
      text,
      {
        italic: true,
      },
      '256color',
    ),
  strikethrough: (text) =>
    styleText(
      text,
      {
        strikethrough: true,
      },
      '256color',
    ),
  underline: (text) =>
    styleText(
      text,
      {
        underline: true,
      },
      '256color',
    ),
};
