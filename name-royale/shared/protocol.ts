// Messages sent over the WebSocket between the Node server and the game page.

/** A viewer. `id` is stable (YouTube channel ID, or a fake ID in the simulator). */
export interface Viewer {
  id: string;
  /** Display name, already profanity-filtered by the server. */
  name: string;
}

export type ChatCommand =
  | { kind: 'join' }
  | { kind: 'boost' }
  | { kind: 'colour'; colour: string }
  | { kind: 'stats' };

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
  | { type: 'hello'; config: import('./config.ts').GameConfig; source: string }
  | { type: 'command'; viewer: Viewer; command: ChatCommand }
  | { type: 'stats'; viewer: Viewer; stats: PlayerStats }
  | { type: 'leaderboard'; entries: LeaderboardEntry[] }
  | { type: 'paid'; event: PaidEvent };

export type GameToServer =
  | { type: 'roundStarted'; round: number }
  /** Human players only, best first. Bots are never sent. */
  | { type: 'roundResult'; round: number; placements: Viewer[] };
