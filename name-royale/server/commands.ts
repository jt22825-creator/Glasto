import type { GameConfig } from '../shared/config.ts';
import { resolveColour } from '../shared/palette.ts';
import type { ChatCommand } from '../shared/protocol.ts';

export type ParsedCommand = ChatCommand | { kind: 'stats' };

/** Turn a chat line into a command, or null if it isn't one. Case-insensitive; "!color" also works. */
export function parseCommand(text: string): ParsedCommand | null {
  const [word, arg] = text.trim().toLowerCase().split(/\s+/);
  switch (word) {
    case '!join':
      return { kind: 'join' };
    case '!boost':
      return { kind: 'boost' };
    case '!colour':
    case '!color': {
      const colour = arg ? resolveColour(arg) : null;
      return colour ? { kind: 'colour', colour } : null;
    }
    case '!stats':
      return { kind: 'stats' };
    default:
      return null;
  }
}

/**
 * Per-viewer cooldowns. Every command shares a short general cooldown;
 * !colour and !stats have their own longer ones. Once-per-round limits
 * (!join, !boost) are enforced by the game, which knows when rounds start.
 */
export class CommandLimiter {
  private lastAny = new Map<string, number>();
  private lastKind = new Map<string, number>();
  private config: GameConfig['commands'];

  constructor(config: GameConfig['commands']) {
    this.config = config;
    // Forget viewers who've been quiet for a while, so memory doesn't grow all stream.
    setInterval(() => this.prune(), 60_000).unref();
  }

  allow(viewerId: string, kind: ParsedCommand['kind'], now = Date.now()): boolean {
    const extra =
      kind === 'colour' ? this.config.colourCooldownSeconds : kind === 'stats' ? this.config.statsCooldownSeconds : 0;
    const kindKey = `${viewerId}:${kind}`;
    if (now - (this.lastAny.get(viewerId) ?? -Infinity) < this.config.perUserCooldownSeconds * 1000) return false;
    if (extra > 0 && now - (this.lastKind.get(kindKey) ?? -Infinity) < extra * 1000) return false;
    this.lastAny.set(viewerId, now);
    if (extra > 0) this.lastKind.set(kindKey, now);
    return true;
  }

  private prune(): void {
    const cutoff = Date.now() - 5 * 60_000;
    for (const [k, t] of this.lastAny) if (t < cutoff) this.lastAny.delete(k);
    for (const [k, t] of this.lastKind) if (t < cutoff) this.lastKind.delete(k);
  }
}
