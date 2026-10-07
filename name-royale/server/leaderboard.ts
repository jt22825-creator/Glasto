// All-time stats per viewer. Kept in memory for now; Stage 4 saves it to disk.
import type { LeaderboardEntry, PlayerStats, Viewer } from '../shared/protocol.ts';

export const LEADERBOARD_SIZE = 10;

export class Leaderboard {
  private players = new Map<string, LeaderboardEntry>();
  nextRound = 1;

  stats(id: string): PlayerStats {
    const p = this.players.get(id);
    return { wins: p?.wins ?? 0, rounds: p?.rounds ?? 0, streak: p?.streak ?? 0 };
  }

  /** Record a finished round. `placements` are humans only; `winner` is null when a bot won. */
  record(round: number, winner: Viewer | null, placements: Viewer[]): void {
    const seen = new Set<string>();
    for (const viewer of placements) {
      if (seen.has(viewer.id)) continue;
      seen.add(viewer.id);
      const p = this.players.get(viewer.id) ?? { id: viewer.id, name: viewer.name, wins: 0, rounds: 0, streak: 0 };
      p.name = viewer.name;
      p.rounds += 1;
      if (winner && viewer.id === winner.id) {
        p.wins += 1;
        p.streak += 1;
      } else {
        p.streak = 0;
      }
      this.players.set(viewer.id, p);
    }
    this.nextRound = Math.max(this.nextRound, round + 1);
  }

  top(n = LEADERBOARD_SIZE): LeaderboardEntry[] {
    return [...this.players.values()]
      .filter((p) => p.wins > 0)
      .sort((a, b) => b.wins - a.wins || b.streak - a.streak || a.rounds - b.rounds || a.name.localeCompare(b.name))
      .slice(0, n);
  }
}
