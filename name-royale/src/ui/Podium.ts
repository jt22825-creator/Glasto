// The 1st / 2nd / 3rd winner screen shown between rounds.
import Phaser from 'phaser';
import { PALETTE, type ColourName } from '../../shared/palette.ts';
import type { PlayerStats } from '../../shared/protocol.ts';
import type { Layout } from '../layout.ts';
import { THEME } from '../theme.ts';
import { bigText, clip } from './text.ts';

export interface PodiumPlace {
  name: string;
  colour: ColourName;
  isBot: boolean;
}

export class Podium {
  private scene: Phaser.Scene;
  private layout: Layout;
  private root: Phaser.GameObjects.Container | undefined;
  private winnerLine: Phaser.GameObjects.Text | undefined;
  private countdown: Phaser.GameObjects.Text | undefined;
  /** Stats can arrive from the server before the podium is on screen. */
  private pendingStats: PlayerStats | undefined;

  constructor(scene: Phaser.Scene, layout: Layout) {
    this.scene = scene;
    this.layout = layout;
  }

  show(round: number, places: PodiumPlace[]): void {
    const pending = this.pendingStats;
    this.hide();
    this.pendingStats = pending;
    const s = this.scene;
    const { x: cx, y: cy, radius: R } = this.layout.arena;
    const root = s.add.container(0, 0).setDepth(60);
    this.root = root;

    root.add(s.add.circle(cx, cy, R + 10, THEME.panel, 0.94));
    root.add(bigText(s, cx, cy - R * 0.78, `ROUND ${round} WINNER`, 52, THEME.textAccent).setOrigin(0.5));

    const winner = places[0];
    root.add(
      bigText(s, cx, cy - R * 0.6, winner ? clip(winner.name, 16) : '—', winner && winner.name.length > 12 ? 70 : 86, THEME.text).setOrigin(0.5),
    );
    this.winnerLine = bigText(s, cx, cy - R * 0.43, winner?.isBot ? 'A bot won this one!' : '', 34, THEME.textDim).setOrigin(0.5);
    root.add(this.winnerLine);

    // Blocks: 2nd left, 1st middle (tallest), 3rd right.
    const blockW = R * 0.5;
    const baseY = cy + R * 0.62;
    const blocks: { place: number; dx: number; h: number; color: number }[] = [
      { place: 2, dx: -blockW, h: R * 0.42, color: THEME.silver },
      { place: 1, dx: 0, h: R * 0.62, color: THEME.gold },
      { place: 3, dx: blockW, h: R * 0.3, color: THEME.bronze },
    ];
    for (const b of blocks) {
      const p = places[b.place - 1];
      const x = cx + b.dx;
      const g = s.add.graphics();
      g.fillStyle(b.color).fillRect(x - blockW / 2 + 6, baseY - b.h, blockW - 12, b.h);
      g.lineStyle(8, THEME.outline).strokeRect(x - blockW / 2 + 6, baseY - b.h, blockW - 12, b.h);
      root.add(g);
      root.add(bigText(s, x, baseY - b.h / 2, String(b.place), 72, THEME.stroke).setStroke(THEME.text, 0).setOrigin(0.5));
      if (!p) continue;
      const ballR = b.place === 1 ? 46 : 36;
      const ballY = baseY - b.h - ballR - 4;
      const ball = s.add.container(x, ballY, [
        s.add.circle(0, 0, ballR, PALETTE[p.colour]).setStrokeStyle(8, THEME.outline),
        ...[-0.34, 0.34].flatMap((ex) => [
          s.add.circle(ex * ballR, -0.16 * ballR, 0.26 * ballR, 0xffffff).setStrokeStyle(4, THEME.outline),
          s.add.circle(ex * ballR, -0.1 * ballR, 0.13 * ballR, THEME.outline),
        ]),
      ]);
      root.add(ball);
      root.add(
        bigText(s, x, baseY - b.h - ballR * 2 - 12, clip(p.name, 11), b.place === 1 ? 34 : 28, p.isBot ? THEME.textDim : THEME.text).setOrigin(0.5, 1),
      );
      if (b.place === 1) {
        s.tweens.add({ targets: ball, y: ball.y - 18, yoyo: true, repeat: -1, duration: 420, ease: 'Sine.easeInOut' });
      }
    }

    if (this.pendingStats) this.setWinnerStats(this.pendingStats);
    this.countdown = bigText(s, cx, cy + R * 0.8, '', 44, THEME.textAccent).setOrigin(0.5);
    root.add(this.countdown);

    root.setAlpha(0);
    s.tweens.add({ targets: root, alpha: 1, duration: 300 });
  }

  /** Called when the server confirms the result, so we can show the winner's all-time numbers. */
  setWinnerStats(stats: PlayerStats): void {
    this.pendingStats = stats;
    const streak = stats.streak > 1 ? `  ·  ${stats.streak} in a row!` : '';
    this.winnerLine?.setText(`${stats.wins} ${stats.wins === 1 ? 'win' : 'wins'} all-time${streak}`).setColor(THEME.textGood);
  }

  setCountdown(text: string): void {
    this.countdown?.setText(text);
  }

  hide(): void {
    this.root?.destroy();
    this.root = undefined;
    this.pendingStats = undefined;
    this.winnerLine = undefined;
    this.countdown = undefined;
  }
}
