import {
  type AutocompleteItem,
  type AutocompleteProvider,
  fuzzyFilter,
} from '@earendil-works/pi-tui';

export type Command = {
  name: string;
  description: string;
  run: (query: string) => Promise<void>;
  suggest?: (query: string, signal: AbortSignal) => Promise<AutocompleteItem[]>;
};

export function commandSuggestions(commands: readonly Command[]): AutocompleteProvider {
  return {
    triggerCharacters: [
      '/',
    ],
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const line = lines[0] ?? '';
      const prefix = line.slice(0, cursorCol);
      if (
        lines.length !== 1 ||
        cursorLine !== 0 ||
        cursorCol !== line.length ||
        !prefix.startsWith('/')
      )
        return null;
      const separator = prefix.indexOf(' ');
      if (separator >= 0) {
        const command = commands.find((command) => command.name === prefix.slice(1, separator));
        if (!command?.suggest) return null;
        const items = await command.suggest(prefix.slice(separator + 1), options.signal);
        return items.length
          ? {
              items,
              prefix,
            }
          : null;
      }
      const items = fuzzyFilter(
        [
          ...commands,
        ],
        prefix.slice(1),
        (command) => command.name,
      ).map((command) => ({
        value: command.name,
        label: `/${command.name}`,
        description: command.description,
      }));
      return items.length
        ? {
            items,
            prefix,
          }
        : null;
    },
    applyCompletion(_lines, _cursorLine, _cursorCol, item) {
      const text = `/${item.value}`;
      return {
        lines: [
          text,
        ],
        cursorLine: 0,
        cursorCol: text.length,
      };
    },
  };
}
