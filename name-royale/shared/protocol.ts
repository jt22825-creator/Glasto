// Messages sent over the WebSocket between the Node server and the game page.
import type { GameConfig } from './config.ts';
import type { ColourName } from './palette.ts';

/** A viewer. `id` is stable (YouTube channel ID, or a fake ID in the simulator). */
export interface Viewer {
  id: string;
  /** Display name, already cleaned up and profanity-filtered by the server. */
  name: string;
}

/** Commands the server forwards to the game. !stats is answered by the server itself. */
export type ChatCommand =
  /** `colour` is the viewer's saved !colour choice, if they have one. */
  | { kind: 'join'; colour?: ColourName }
  | { kind: 'boost' }
  | { kind: 'colour'; colour: ColourName };

export interface PlayerStats {
  wins: number;
  rounds: number;
  streak: number;
}

export interface LeaderboardEntry extends PlayerStats {
  id: string;
  name: string;
}

/** Paid events. The game decides what cosmetic or chaotic thing to do with them. */
export type PaidEvent =
  | { kind: 'superChat'; viewer: Viewer; amountMicros: number; currency: string; tier: number }
  | { kind: 'sponsor'; viewer: Viewer };

export type ServerToGame =
  | {
      type: 'hello';
      config: GameConfig;
      source: string;
      /** The round number the server expects next. */
      nextRound: number;
      /**
       * Only the primary screen's results count. If you open a preview tab
       * while OBS is running, the tab is not primary and its rounds aren't recorded.
       */
      primary: boolean;
      /** The show is ending (see 'endStream'); go straight to the end card. */
      ending: boolean;
    }
  | { type: 'role'; primary: boolean }
  | { type: 'command'; viewer: Viewer; command: ChatCommand }
  | { type: 'stats'; viewer: Viewer; stats: PlayerStats }
  | { type: 'leaderboard'; entries: LeaderboardEntry[] }
  | { type: 'roundRecorded'; round: number; winner: Viewer | null; winnerStats: PlayerStats | null }
  | { type: 'paid'; event: PaidEvent }
  /** Finish the current round, then show the end card and reply 'ended'. */
  | { type: 'endStream'; reason: string };

export type GameToServer =
  | {
      type: 'roundResult';
      round: number;
      /** The overall winner, or null if a bot won. */
      winner: Viewer | null;
      /** Every human who played, best placement first. Bots are never sent. */
      placements: Viewer[];
    }
  /** The end card is on screen. */
  | { type: 'ended' };
