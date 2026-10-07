// The always-visible all-time leaderboard: wins, rounds played, current streak.
// Landscape: a tall list, two lines per player.
// Vertical: a short strip showing 3 players at a time, paging through the top 9.
import Phaser from 'phaser';
import type { LeaderboardEntry } from '../../shared/protocol.ts';
import type { Layout } from '../layout.ts';
import { THEME } from '../theme.ts';
import { bigText, clip, panel } from './text.ts';

const PAGE_MS = 6000;

interface Slot {
  rank: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  detail: Phaser.GameObjects.Text;
  streak: Phaser.GameObjects.Text;
}

export class LeaderboardPanel {
  private slots: Slot[] = [];
  private empty: Phaser.GameObjects.Text;
  private title: Phaser.GameObjects.Text;
  private strip: boolean;
  private maxRows: number;
  private entries: LeaderboardEntry[] = [];
  private page = 0;

  constructor(scene: Phaser.Scene, layout: Layout) {
    const r = layout.leaderboard;
    this.strip = r.style === 'strip';
    this.maxRows = r.rows;
    panel(scene, r, 50);

    if (this.strip) {
      this.title = bigText(scene, r.x + 24, r.y + 12, 'ALL-TIME WINS', 28, THEME.textAccent).setDepth(51);
      const colW = (r.w - 24) / 3;
      for (let i = 0; i < 3; i++) {
        const x = r.x + 24 + i * colW;
        this.slots.push({
          rank: bigText(scene, x, r.y + 54, '', 36, THEME.textAccent),
          name: bigText(scene, x + 46, r.y + 54, '', 36),
          detail: bigText(scene, x, r.y + 104, '', 24, THEME.textDim),
          streak: bigText(scene, x + colW - 20, r.y + 104, '', 24, THEME.textDanger).setOrigin(1, 0),
        });
      }
      scene.time.addEvent({ delay: PAGE_MS, loop: true, callback: () => this.nextPage() });
    } else {
      this.title = bigText(scene, r.x + 24, r.y + 18, 'ALL-TIME WINS', 34, THEME.textAccent).setDepth(51);
      const rowH = (r.h - 84) / r.rows;
      const right = r.x + r.w - 24;
      for (let i = 0; i < r.rows; i++) {
        const y = r.y + 76 + i * rowH;
        this.slots.push({
          rank: bigText(scene, r.x + 24, y, '', 30, THEME.textAccent),
          name: bigText(scene, r.x + 70, y, '', 30),
          detail: bigText(scene, r.x + 70, y + 36, '', 21, THEME.textDim),
          streak: bigText(scene, right, y + 4, '', 26, THEME.textDanger).setOrigin(1, 0),
        });
      }
    }
    for (const s of this.slots) for (const t of [s.rank, s.name, s.detail, s.streak]) t.setDepth(51);
    this.empty = bigText(scene, r.x + 24, r.y + (this.strip ? 60 : 90), 'No winners yet. Will it be you?', this.strip ? 34 : 28, THEME.textDim)
      .setDepth(51)
      .setWordWrapWidth(r.w - 48);
  }

  setEntries(entries: LeaderboardEntry[]): void {
    this.entries = entries.slice(0, this.maxRows);
    if (this.page * 3 >= this.entries.length) this.page = 0;
    this.render();
  }

  private nextPage(): void {
    const pages = Math.ceil(this.entries.length / 3);
    if (pages <= 1) return;
    this.page = (this.page + 1) % pages;
    this.render();
  }

  private render(): void {
    this.empty.setVisible(this.entries.length === 0);
    const offset = this.strip ? this.page * 3 : 0;
    const pages = Math.ceil(this.entries.length / 3);
    if (this.strip) this.title.setText(pages > 1 ? `ALL-TIME WINS · ${offset + 1}–${Math.min(offset + 3, this.entries.length)}` : 'ALL-TIME WINS');

    this.slots.forEach((slot, i) => {
      const e = this.entries[offset + i];
      slot.rank.setText(e ? `${offset + i + 1}` : '');
      slot.name.setText(e ? clip(e.name, this.strip ? 12 : e.streak > 1 ? 12 : 15) : '');
      slot.detail.setText(e ? (this.strip ? `${e.wins}W · ${e.rounds} ${e.rounds === 1 ? 'round' : 'rounds'}` : `${e.wins} ${e.wins === 1 ? 'win' : 'wins'} · ${e.rounds} ${e.rounds === 1 ? 'round' : 'rounds'}`) : '');
      slot.streak.setText(e && e.streak > 1 ? `🔥${e.streak}` : '');
    });
  }
}
