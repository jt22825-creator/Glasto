// Hooks for paid YouTube events (Super Chats, new members).
//
// Right now they only show a thank-you card. Later they can trigger extras,
// for example spawning a bumper in the arena or dropping a meteor. Rule of
// thumb: paid extras should be cosmetic or chaotic for everyone, never a
// guaranteed win for the person who paid.
import { clip } from '../ui/text.ts';
import type { Feed } from '../ui/Feed.ts';
import type { Toasts } from '../ui/Toasts.ts';
import type { Viewer } from '../../shared/protocol.ts';
import { THEME } from '../theme.ts';

/** What the hooks are allowed to do to the game. Add methods here as extras are built. */
export interface GameApi {
  toasts: Toasts;
  feed: Feed;
  isFighting(): boolean;
  announce(text: string, color: string): void;
  // Ideas for later:
  // spawnBumper(x: number, y: number): void;
  // meteor(): void;
}

export class PaidHooks {
  private game: GameApi;

  constructor(game: GameApi) {
    this.game = game;
  }

  /**
   * A Super Chat arrived. `amountMicros` is in millionths of `currency`
   * (5_000_000 = 5.00). `tier` is YouTube's Super Chat tier (1 = smallest).
   */
  onSuperChat(amountMicros: number, currency: string, viewer: Viewer, tier: number): void {
    const amount = (amountMicros / 1_000_000).toFixed(2).replace(/\.00$/, '');
    this.game.toasts.show(`💛 ${clip(viewer.name, 16)}`, `Thanks for the ${currency} ${amount} Super Chat!`, THEME.gold);
    this.game.feed.push(`💛 ${viewer.name} sent a Super Chat`, THEME.textAccent);
    // Example for later:
    // if (tier >= 3 && this.game.isFighting()) this.game.meteor();
    void tier;
  }

  /** Someone became a channel member. */
  onSponsor(viewer: Viewer): void {
    this.game.toasts.show(`⭐ ${clip(viewer.name, 16)}`, 'Welcome to the members!', THEME.good);
    this.game.feed.push(`⭐ ${viewer.name} became a member`, THEME.textGood);
  }
}
