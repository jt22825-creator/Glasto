// Pop-up cards (!stats, Super Chat thank-yous). One at a time, queued.
import Phaser from 'phaser';
import type { Layout } from '../layout.ts';
import { THEME } from '../theme.ts';
import { bigText } from './text.ts';

interface Toast {
  title: string;
  body: string;
  color: number;
  ms: number;
}

const MAX_QUEUE = 6;

export class Toasts {
  private queue: Toast[] = [];
  private showing = false;
  private scene: Phaser.Scene;
  private layout: Layout;

  constructor(scene: Phaser.Scene, layout: Layout) {
    this.scene = scene;
    this.layout = layout;
  }

  show(title: string, body: string, color: number = THEME.accent, ms = 3500): void {
    if (this.queue.length >= MAX_QUEUE) this.queue.shift(); // drop the oldest if chat floods !stats
    this.queue.push({ title, body, color, ms });
    if (!this.showing) this.next();
  }

  private next(): void {
    const t = this.queue.shift();
    if (!t) {
      this.showing = false;
      return;
    }
    this.showing = true;
    const r = this.layout.toast;
    const vertical = this.layout.name === 'vertical';
    const card = this.scene.add.container(r.x, r.y).setDepth(80);
    const bg = this.scene.add.graphics().fillStyle(t.color).fillRoundedRect(0, 0, r.w, r.h, 22).lineStyle(6, THEME.outline).strokeRoundedRect(0, 0, r.w, r.h, 22);
    card.add(bg);
    if (vertical) {
      card.add(bigText(this.scene, r.w / 2, r.h / 2, `${t.title}: ${t.body.replace(/\n/g, ' · ')}`, 30).setOrigin(0.5).setFixedSize(r.w - 30, 0).setAlign('center'));
    } else {
      card.add(bigText(this.scene, 24, 22, t.title, 38).setWordWrapWidth(r.w - 48));
      card.add(bigText(this.scene, 24, 120, t.body, 34).setWordWrapWidth(r.w - 48).setLineSpacing(6));
    }
    card.setAlpha(0).setScale(0.9);
    this.scene.tweens.add({ targets: card, alpha: 1, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.scene.time.delayedCall(t.ms, () => {
      this.scene.tweens.add({
        targets: card,
        alpha: 0,
        duration: 200,
        onComplete: () => {
          card.destroy();
          this.next();
        },
      });
    });
  }
}
