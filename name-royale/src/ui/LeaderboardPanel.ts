// The always-visible all-time leaderboard: wins, rounds played, current streak.
// Landscape: two lines per player (name, then numbers). Vertical: one wide line.
import Phaser from 'phaser';
import type { LeaderboardEntry } from '../../shared/protocol.ts';
import type { Layout } from '../layout.ts';
import { THEME } from '../theme.ts';
import { bigText, clip, panel } from './text.ts';

interface Row {
  rank: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  /** Landscape: "3 wins · 7 rounds". Vertical: wins column. */
  a: Phaser.GameObjects.Text;
  /** Vertical only: rounds column. */
  b?: Phaser.GameObjects.Text;
  streak: Phaser.GameObjects.Text;
}

export class LeaderboardPanel {
  private rows: Row[] = [];
  private empty: Phaser.GameObjects.Text;
  private vertical: boolean;

  constructor(scene: Phaser.Scene, layout: Layout) {
    const r = layout.leaderboard;
    this.vertical = layout.name === 'vertical';
    panel(scene, r, 50);
    const right = r.x + r.w - 24;

    bigText(scene, r.x + 24, r.y + 18, 'ALL-TIME WINS', this.vertical ? 40 : 34, THEME.textAccent).setDepth(51);

    if (this.vertical) {
      const cols = { wins: right - 240, rounds: right - 120, streak: right };
      for (const [label, x] of [['WINS', cols.wins], ['RNDS', cols.rounds], ['🔥', cols.streak]] as const) {
        bigText(scene, x, r.y + 28, label, 24, THEME.textDim).setOrigin(1, 0).setDepth(51);
      }
      for (let i = 0; i < r.rows; i++) {
        const y = r.y + 80 + i * 50;
        this.rows.push({
          rank: bigText(scene, r.x + 24, y, '', 38, THEME.textDim),
          name: bigText(scene, r.x + 80, y, '', 38),
          a: bigText(scene, cols.wins, y, '', 38, THEME.textAccent).setOrigin(1, 0),
          b: bigText(scene, cols.rounds, y, '', 38, THEME.textDim).setOrigin(1, 0),
          streak: bigText(scene, cols.streak, y, '', 38, THEME.textDanger).setOrigin(1, 0),
        });
      }
    } else {
      const rowH = (r.h - 84) / r.rows;
      for (let i = 0; i < r.rows; i++) {
        const y = r.y + 76 + i * rowH;
        this.rows.push({
          rank: bigText(scene, r.x + 24, y, '', 30, THEME.textAccent),
          name: bigText(scene, r.x + 70, y, '', 30),
          a: bigText(scene, r.x + 70, y + 36, '', 21, THEME.textDim),
          streak: bigText(scene, right, y + 4, '', 26, THEME.textDanger).setOrigin(1, 0),
        });
      }
    }
    for (const row of this.rows) for (const t of [row.rank, row.name, row.a, row.b, row.streak]) t?.setDepth(51);
    this.empty = bigText(scene, r.x + 24, r.y + 90, 'No winners yet.\nWill it be you?', this.vertical ? 34 : 28, THEME.textDim).setDepth(51);
  }

  setEntries(entries: LeaderboardEntry[]): void {
    this.empty.setVisible(entries.length === 0);
    this.rows.forEach((row, i) => {
      const e = entries[i];
      row.rank.setText(e ? `${i + 1}` : '');
      row.streak.setText(e && e.streak > 1 ? `🔥${e.streak}` : '');
      if (this.vertical) {
        row.name.setText(e ? clip(e.name, 20) : '');
        row.a.setText(e ? `${e.wins}` : '');
        row.b?.setText(e ? `${e.rounds}` : '');
        row.streak.setText(e && e.streak > 1 ? `${e.streak}` : '');
      } else {
        row.name.setText(e ? clip(e.name, e.streak > 1 ? 12 : 15) : '');
        row.a.setText(e ? `${e.wins} ${e.wins === 1 ? 'win' : 'wins'} · ${e.rounds} ${e.rounds === 1 ? 'round' : 'rounds'}` : '');
      }
    });
  }
}
