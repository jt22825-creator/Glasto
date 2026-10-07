// A short list of recent events: joins, eliminations, boosts.
import Phaser from 'phaser';
import type { Layout } from '../layout.ts';
import { THEME } from '../theme.ts';
import { bigText, panel } from './text.ts';

export class Feed {
  private lines: Phaser.GameObjects.Text[] = [];
  private entries: { text: string; color: string }[] = [];

  constructor(scene: Phaser.Scene, layout: Layout) {
    const r = layout.feed;
    panel(scene, r, 50);
    const size = layout.name === 'vertical' ? 34 : 28;
    const lineH = layout.name === 'vertical' ? 0 : 46;
    for (let i = 0; i < r.lines; i++) {
      const y = layout.name === 'vertical' ? r.y + r.h / 2 : r.y + 20 + i * lineH;
      const t = bigText(scene, r.x + 22, y, '', size, THEME.textDim).setDepth(51);
      if (layout.name === 'vertical') t.setOrigin(0, 0.5);
      t.setFixedSize(r.w - 44, 0);
      this.lines.push(t);
    }
  }

  push(text: string, color: string = THEME.textDim): void {
    this.entries.unshift({ text, color });
    this.entries.length = Math.min(this.entries.length, this.lines.length);
    this.lines.forEach((line, i) => {
      const e = this.entries[i];
      line.setText(e?.text ?? '').setColor(e?.color ?? THEME.textDim).setAlpha(1 - i * 0.045);
    });
  }
}
