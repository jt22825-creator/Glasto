// Round number, phase name, players left and the big timer.
import Phaser from 'phaser';
import type { Layout } from '../layout.ts';
import { THEME } from '../theme.ts';
import { bigText, panel } from './text.ts';

export class Hud {
  private round: Phaser.GameObjects.Text;
  private phase: Phaser.GameObjects.Text;
  private timer: Phaser.GameObjects.Text;
  private alive: Phaser.GameObjects.Text;
  private lastTimer = '';

  constructor(scene: Phaser.Scene, layout: Layout) {
    const r = layout.hud;
    panel(scene, r, 50);
    if (layout.name === 'landscape') {
      this.round = bigText(scene, r.x + 28, r.y + 20, '', 46, THEME.textAccent);
      this.phase = bigText(scene, r.x + 28, r.y + 78, '', 34);
      this.timer = bigText(scene, r.x + 24, r.y + 118, '', 120);
      this.alive = bigText(scene, r.x + 28, r.y + 250, '', 30, THEME.textDim);
    } else {
      this.round = bigText(scene, r.x + 30, r.y + 18, '', 50, THEME.textAccent);
      this.phase = bigText(scene, r.x + 30, r.y + 80, '', 36);
      this.alive = bigText(scene, r.x + 30, r.y + 132, '', 32, THEME.textDim);
      this.timer = bigText(scene, r.x + r.w - 30, r.y + r.h / 2, '', 130).setOrigin(1, 0.5);
    }
    for (const t of [this.round, this.phase, this.timer, this.alive]) t.setDepth(51);
  }

  setRound(n: number): void {
    this.round.setText(`ROUND ${n}`);
  }

  setPhase(text: string, color: string = THEME.text): void {
    this.phase.setText(text).setColor(color);
  }

  setAlive(text: string): void {
    this.alive.setText(text);
  }

  /** Show seconds as m:ss, or a short word. Turns red in the last 10 seconds when `urgent`. */
  setTimer(seconds: number | string, urgent = false): void {
    let text: string;
    if (typeof seconds === 'string') text = seconds;
    else {
      const s = Math.ceil(Math.max(0, seconds));
      text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    if (text !== this.lastTimer) {
      this.lastTimer = text;
      this.timer.setText(text);
    }
    this.timer.setColor(urgent ? THEME.textDanger : THEME.text);
  }
}
