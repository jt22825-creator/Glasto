// All-time stats per viewer, saved to data/leaderboard.json so they survive
// restarts. Bots never get here (the game only reports humans).
//
// Saving is crash-safe: the new file is written next to the old one and then
// swapped in, and the previous version is kept as leaderboard.backup.json.
// If the file is ever unreadable it is set aside (never deleted) and the
// backup is used instead.
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ColourName } from '../shared/palette.ts';
import type { LeaderboardEntry, PlayerStats, Viewer } from '../shared/protocol.ts';
import { dataDir, ensureDir } from './paths.ts';

export const LEADERBOARD_SIZE = 10;
const SAVE_DELAY_MS = 1000;

interface PlayerRecord extends PlayerStats {
  name: string;
  colour?: ColourName;
  /** Last time this viewer played or changed colour (ISO date). */
  lastSeen: string;
}

interface LeaderboardFile {
  version: 1;
  nextRound: number;
  players: Record<string, PlayerRecord>;
}

export class Leaderboard {
  private file: string;
  private backup: string;
  private data: LeaderboardFile;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(dir = dataDir()) {
    ensureDir(dir);
    this.file = join(dir, 'leaderboard.json');
    this.backup = join(dir, 'leaderboard.backup.json');
    this.data = this.load();
    const count = Object.keys(this.data.players).length;
    console.log(`[leaderboard] ${count} players loaded, next round is ${this.data.nextRound} (${this.file})`);
  }

  private load(): LeaderboardFile {
    const fresh: LeaderboardFile = { version: 1, nextRound: 1, players: {} };
    for (const path of [this.file, this.backup]) {
      if (!existsSync(path)) continue;
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as LeaderboardFile;
        if (typeof parsed?.players !== 'object' || parsed.players === null) throw new Error('no players section');
        if (path === this.backup) console.warn('[leaderboard] Main file was unreadable; loaded the backup instead.');
        return { version: 1, nextRound: Number(parsed.nextRound) || 1, players: parsed.players };
      } catch (err) {
        const aside = path.replace(/\.json$/, `.unreadable-${Date.now()}.json`);
        console.error(`[leaderboard] Could not read ${path} (${(err as Error).message}). Moved it to ${aside}.`);
        try {
          renameSync(path, aside);
        } catch {
          // leave it where it is
        }
      }
    }
    return fresh;
  }

  get nextRound(): number {
    return this.data.nextRound;
  }

  stats(id: string): PlayerStats {
    const p = this.data.players[id];
    return { wins: p?.wins ?? 0, rounds: p?.rounds ?? 0, streak: p?.streak ?? 0 };
  }

  colour(id: string): ColourName | undefined {
    return this.data.players[id]?.colour;
  }

  setColour(viewer: Viewer, colour: ColourName): void {
    const p = this.player(viewer);
    p.colour = colour;
    this.scheduleSave();
  }

  /** Record a finished round. `placements` are humans only; `winner` is null when a bot won. */
  record(round: number, winner: Viewer | null, placements: Viewer[]): void {
    const seen = new Set<string>();
    for (const viewer of placements) {
      if (seen.has(viewer.id)) continue;
      seen.add(viewer.id);
      const p = this.player(viewer);
      p.rounds += 1;
      if (winner && viewer.id === winner.id) {
        p.wins += 1;
        p.streak += 1;
      } else {
        p.streak = 0;
      }
    }
    this.data.nextRound = Math.max(this.data.nextRound, round + 1);
    this.scheduleSave();
  }

  /** Top players by wins. `hide` filters out e.g. banned viewers. */
  top(n = LEADERBOARD_SIZE, hide: (e: LeaderboardEntry) => boolean = () => false): LeaderboardEntry[] {
    return Object.entries(this.data.players)
      .map(([id, p]) => ({ id, name: p.name, wins: p.wins, rounds: p.rounds, streak: p.streak }))
      .filter((p) => p.wins > 0 && !hide(p))
      .sort((a, b) => b.wins - a.wins || b.streak - a.streak || a.rounds - b.rounds || a.name.localeCompare(b.name))
      .slice(0, n);
  }

  private player(viewer: Viewer): PlayerRecord {
    const p = (this.data.players[viewer.id] ??= { name: viewer.name, wins: 0, rounds: 0, streak: 0, lastSeen: '' });
    p.name = viewer.name; // keep up with name changes
    p.lastSeen = new Date().toISOString();
    return p;
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  /** Write to disk now. Called automatically shortly after each change, and on shutdown. */
  save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 1));
      if (existsSync(this.file)) copyFileSync(this.file, this.backup);
      renameWithRetry(tmp, this.file);
    } catch (err) {
      console.error(`[leaderboard] Could not save ${this.file}: ${(err as Error).message}`);
    }
  }
}

/** On Windows, antivirus or backup tools can briefly lock a file; try a few times. */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      if (attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes((err as NodeJS.ErrnoException).code ?? '')) throw err;
      const until = Date.now() + 50 * (attempt + 1);
      while (Date.now() < until) {
        // brief synchronous wait; this only happens in rare lock conflicts
      }
    }
  }
}
