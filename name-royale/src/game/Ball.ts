// One player's ball: a Matter physics body plus the drawing that follows it.
// The drawing is a flat coloured disc with two eyes that look where it's going,
// and the player's name above it.
import Phaser from 'phaser';
import { PALETTE, type ColourName } from '../../shared/palette.ts';
import type { Viewer } from '../../shared/protocol.ts';
import { THEME } from '../theme.ts';

/** Visuals are drawn at this radius, then scaled to the real size. */
const BASE_RADIUS = 50;

export class Ball {
  readonly viewer: Viewer;
  readonly isBot: boolean;
  readonly body: MatterJS.BodyType;
  colour: ColourName;
  radius: number;
  /** Direction this ball is wandering in (radians). Changes a little each frame. */
  heading = Math.random() * Math.PI * 2;
  boostsUsed = 0;
  out = false;

  private scene: Phaser.Scene;
  private sprite: Phaser.GameObjects.Container;
  private disc: Phaser.GameObjects.Arc;
  private pupils: Phaser.GameObjects.Arc[];
  private label: Phaser.GameObjects.Text;
  private hpTag: Phaser.GameObjects.Text | undefined;
  /** Extra scale used by the drop-in animation (tweened from big to 1). */
  dropScale = 1;
  /** In crowded rounds, most balls only show initials. */
  private shortLabel = false;

  constructor(scene: Phaser.Scene, viewer: Viewer, isBot: boolean, colour: ColourName, x: number, y: number, radius: number) {
    this.scene = scene;
    this.viewer = viewer;
    this.isBot = isBot;
    this.colour = colour;
    this.radius = radius;

    this.body = scene.matter.add.circle(x, y, radius, {
      restitution: 0.9,
      friction: 0,
      frictionStatic: 0,
      frictionAir: 0.025,
      density: 0.002,
      label: 'ball',
    });

    this.disc = scene.add.circle(0, 0, BASE_RADIUS, PALETTE[colour]).setStrokeStyle(9, THEME.outline);
    const eyes = [-17, 17].map((ex) => scene.add.circle(ex, -8, 13, 0xffffff).setStrokeStyle(4, THEME.outline));
    this.pupils = [-17, 17].map((ex) => scene.add.circle(ex, -8, 6.5, THEME.outline));
    this.sprite = scene.add.container(x, y, [this.disc, ...eyes, ...this.pupils]).setDepth(10);

    this.label = scene.add
      .text(x, y, viewer.name, {
        fontFamily: THEME.font,
        fontSize: '30px',
        color: isBot ? THEME.textDim : THEME.text,
        stroke: THEME.stroke,
        strokeThickness: 8,
      })
      .setOrigin(0.5, 1)
      .setDepth(isBot ? 20 : 21);

    this.applyRadius();
  }

  get x(): number {
    return this.body.position.x;
  }

  get y(): number {
    return this.body.position.y;
  }

  /** Resize the ball (used while players are still joining, so a busy round still fits). */
  setRadius(radius: number): void {
    if (Math.abs(radius - this.radius) < 0.5) return;
    const s = radius / this.radius;
    this.scene.matter.body.scale(this.body, s, s);
    this.radius = radius;
    this.applyRadius();
  }

  private applyRadius(): void {
    // Big names in normal rounds; a little smaller when the arena is packed.
    const full = Phaser.Math.Clamp(Math.round(this.radius * 0.8), 22, 38);
    const fontSize = this.shortLabel ? Math.max(18, Math.round(full * 0.7)) : full;
    this.label.setFontSize(fontSize);
    this.label.setStroke(THEME.stroke, Math.max(5, fontSize / 4));
  }

  /** Show the full name, or just initials (used when the arena is crowded). */
  setShortLabel(short: boolean): void {
    if (short === this.shortLabel) return;
    this.shortLabel = short;
    this.label.setText(short ? initials(this.viewer.name) : this.viewer.name);
    this.label.setAlpha(short ? 0.75 : 1);
    this.applyRadius();
  }

  setColour(colour: ColourName): void {
    this.colour = colour;
    this.disc.setFillStyle(PALETTE[colour]);
  }

  /** Kick the ball by changing its velocity directly (pixels per physics step). */
  kick(dx: number, dy: number): void {
    const v = this.body.velocity;
    this.scene.matter.body.setVelocity(this.body, { x: v.x + dx, y: v.y + dy });
  }

  /** Show the "1 HP" tag used when only two balls are left. */
  showHp(): void {
    if (this.hpTag) return;
    this.hpTag = this.scene.add
      .text(this.x, this.y, '♥ 1 HP', {
        fontFamily: THEME.font,
        fontSize: '28px',
        color: THEME.textDanger,
        stroke: THEME.stroke,
        strokeThickness: 7,
      })
      .setOrigin(0.5, 0)
      .setDepth(22);
    this.scene.tweens.add({ targets: this.hpTag, scale: 1.15, yoyo: true, repeat: -1, duration: 350 });
  }

  /** Move the drawing to match the physics body. Call once per frame. */
  sync(): void {
    const { x, y } = this.body.position;
    const scale = (this.radius / BASE_RADIUS) * this.dropScale;
    this.sprite.setPosition(x, y).setScale(scale);
    this.label.setPosition(x, y - this.radius * this.dropScale - 4);
    this.hpTag?.setPosition(x, y + this.radius + 4);

    // Pupils look in the direction of travel.
    const v = this.body.velocity;
    const speed = Math.hypot(v.x, v.y);
    const look = Math.min(1, speed / 3) * 5;
    const lx = speed > 0.01 ? (v.x / speed) * look : 0;
    const ly = speed > 0.01 ? (v.y / speed) * look : 0;
    this.pupils[0].setPosition(-17 + lx, -8 + ly);
    this.pupils[1].setPosition(17 + lx, -8 + ly);
  }

  /** Take the ball out of the physics world and play a quick pop. */
  eliminate(onDone?: () => void): void {
    this.out = true;
    this.scene.matter.world.remove(this.body);
    this.hpTag?.destroy();
    this.scene.tweens.add({
      targets: [this.sprite, this.label],
      alpha: 0,
      scale: `*=1.6`,
      duration: 380,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.destroy();
        onDone?.();
      },
    });
  }

  destroy(): void {
    if (!this.out) this.scene.matter.world.remove(this.body);
    this.out = true;
    this.sprite.destroy();
    this.label.destroy();
    this.hpTag?.destroy();
  }
}

/** "NeonGecko42" -> "NG", "bot_pebble" -> "BP", "alice" -> "AL". */
export function initials(name: string): string {
  const caps = name.match(/[A-Z]/g);
  if (caps && caps.length >= 2) return caps.slice(0, 2).join('');
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return [...name].slice(0, 2).join('').toUpperCase();
}
