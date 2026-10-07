import type { ChatCommand } from '../shared/protocol.ts';

/** Turn a chat line into a command, or null if it isn't one. Case-insensitive; "!color" also works. */
export function parseCommand(text: string): ChatCommand | null {
  const [word, arg] = text.trim().toLowerCase().split(/\s+/);
  switch (word) {
    case '!join':
      return { kind: 'join' };
    case '!boost':
      return { kind: 'boost' };
    case '!colour':
    case '!color':
      return arg ? { kind: 'colour', colour: arg } : null;
    case '!stats':
      return { kind: 'stats' };
    default:
      return null;
  }
}
