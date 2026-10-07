import Phaser from 'phaser';
import { THEME } from '../theme.ts';

/** Big outlined text in the house style. */
export function bigText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size: number,
  color: string = THEME.text,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: THEME.font,
    fontSize: `${size}px`,
    color,
    stroke: THEME.stroke,
    strokeThickness: Math.max(4, Math.round(size / 7)),
  });
}

export function panel(scene: Phaser.Scene, r: { x: number; y: number; w: number; h: number }, depth = 0): Phaser.GameObjects.Graphics {
  return scene.add.graphics().setDepth(depth).fillStyle(THEME.panel, 0.88).fillRoundedRect(r.x, r.y, r.w, r.h, 22);
}

/** Shorten a name to fit a column. */
export function clip(name: string, max: number): string {
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}
