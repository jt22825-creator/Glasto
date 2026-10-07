// Ends the show cleanly: the game finishes its current round and shows a
// "Thanks for playing" card, then (optionally) OBS is told to stop streaming.
// Triggered when the YouTube quota runs out, or when you type "end".
import type { GameConfig } from '../shared/config.ts';
import type { Hub } from './hub.ts';
import { stopObsStream } from './obs.ts';

/** Longest we wait for the current round to finish (a full fight is under 3 minutes). */
const MAX_WAIT_FOR_ROUND_MS = 4 * 60_000;

export class ShowEnder {
  private config: GameConfig['ending'];
  private hub: Hub;
  private gameEnded: (() => void) | undefined;
  ending = false;

  constructor(config: GameConfig['ending'], hub: Hub) {
    this.config = config;
    this.hub = hub;
  }

  /** The primary screen says the end card is showing. */
  onGameEnded(): void {
    this.gameEnded?.();
  }

  async begin(reason: string): Promise<void> {
    if (this.ending) return;
    this.ending = true;
    console.log(`\n[end] Ending the show: ${reason}`);
    console.log('[end] Letting the current round finish, then showing the end card...');
    this.hub.broadcast({ type: 'endStream', reason });

    await new Promise<void>((resolve) => {
      this.gameEnded = resolve;
      setTimeout(resolve, MAX_WAIT_FOR_ROUND_MS);
    });
    console.log(`[end] End card is up. Stopping in ${this.config.endCardSeconds}s.`);
    await new Promise((r) => setTimeout(r, this.config.endCardSeconds * 1000));

    if (!this.config.stopObsStream) {
      shout('Time to stop your stream in OBS (automatic stopping is turned off).');
      return;
    }
    try {
      console.log(`[end] ${await stopObsStream(this.config.obsWebSocketUrl)}.`);
    } catch (err) {
      shout(`Couldn't stop OBS automatically: ${(err as Error).message}.\n  Please stop your stream in OBS now.`);
    }
  }
}

function shout(message: string): void {
  console.log(`\n${'!'.repeat(60)}\n  ${message}\n${'!'.repeat(60)}\n`);
}
