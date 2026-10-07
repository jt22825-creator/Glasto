// Particles and flashes. Textures are drawn once at startup (a dot and a
// confetti strip), and each effect is a short-lived Phaser particle emitter.
import Phaser from 'phaser';
import { PALETTE } from '../../shared/palette.ts';
import { THEME } from '../theme.ts';

export class Effects {
  private scene: Phaser.Scene;
  private flashRect: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, width: number, height: number) {
    this.scene = scene;
    if (!scene.textures.exists('fx-dot')) {
      const g = scene.make.graphics({}, false);
      g.fillStyle(0xffffff).fillCircle(12, 12, 12).generateTexture('fx-dot', 24, 24);
      g.clear().fillStyle(0xffffff).fillRect(0, 0, 18, 9).generateTexture('fx-confetti', 18, 9);
      g.destroy();
    }
    this.flashRect = scene.add.rectangle(0, 0, width, height, 0xffffff).setOrigin(0).setDepth(85).setAlpha(0);
  }

  private oneShot(x: number, y: number, texture: string, config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, count: number, depth = 15): void {
    const emitter = this.scene.add.particles(x, y, texture, { ...config, emitting: false }).setDepth(depth);
    emitter.explode(count);
    const life = typeof config.lifespan === 'number' ? config.lifespan : 1500;
    this.scene.time.delayedCall(life + 200, () => emitter.destroy());
  }

  /** A ball is knocked out: a burst in its colour, white sparks, and a ring. */
  elimination(x: number, y: number, colour: number, big: boolean): void {
    this.oneShot(x, y, 'fx-dot', { speed: { min: 180, max: big ? 700 : 480 }, lifespan: big ? 900 : 650, scale: { start: big ? 1.1 : 0.8, end: 0 }, tint: colour }, big ? 46 : 26);
    this.oneShot(x, y, 'fx-dot', { speed: { min: 300, max: 900 }, lifespan: 380, scale: { start: 0.35, end: 0 }, tint: 0xffffff }, big ? 24 : 12);
    const ring = this.scene.add.circle(x, y, 20).setStrokeStyle(big ? 12 : 8, colour).setDepth(14);
    this.scene.tweens.add({ targets: ring, radius: big ? 220 : 130, alpha: 0, duration: big ? 650 : 450, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
  }

  /** A hard hit: a quick white (or coloured) spark. */
  hit(x: number, y: number, colour = 0xffffff): void {
    this.oneShot(x, y, 'fx-dot', { speed: { min: 120, max: 360 }, lifespan: 260, scale: { start: 0.4, end: 0 }, tint: colour }, 8);
  }

  /** A ball drops into the arena: a small dust puff. */
  landing(x: number, y: number, radius: number): void {
    this.oneShot(x, y, 'fx-dot', { speed: { min: 60, max: 180 }, lifespan: 380, scale: { start: radius / 40, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: THEME.floorLine }, 10, 9);
  }

  /** !boost: a quick spray of sparks behind the ball. */
  boost(x: number, y: number, dirX: number, dirY: number): void {
    const angle = Phaser.Math.RadToDeg(Math.atan2(-dirY, -dirX));
    this.oneShot(x, y, 'fx-dot', { speed: { min: 200, max: 520 }, angle: { min: angle - 25, max: angle + 25 }, lifespan: 420, scale: { start: 0.5, end: 0 }, tint: [THEME.good, 0xffffff] }, 18);
  }

  /** Confetti raining over the arena for the winner. */
  confetti(x: number, y: number, width: number): void {
    const emitter = this.scene.add
      .particles(x, y, 'fx-confetti', {
        x: { min: -width / 2, max: width / 2 },
        speedX: { min: -140, max: 140 },
        speedY: { min: -60, max: 160 },
        gravityY: 420,
        rotate: { min: 0, max: 360 },
        lifespan: 2600,
        quantity: 4,
        frequency: 40,
        scale: { min: 0.8, max: 1.5 },
        tint: Object.values(PALETTE),
      })
      .setDepth(70);
    this.scene.time.delayedCall(1800, () => emitter.stop());
    this.scene.time.delayedCall(4600, () => emitter.destroy());
  }

  /** A quick full-screen flash. */
  flash(colour = 0xffffff, alpha = 0.45, ms = 220): void {
    this.flashRect.setFillStyle(colour).setAlpha(alpha);
    this.scene.tweens.killTweensOf(this.flashRect);
    this.scene.tweens.add({ targets: this.flashRect, alpha: 0, duration: ms });
  }
}
