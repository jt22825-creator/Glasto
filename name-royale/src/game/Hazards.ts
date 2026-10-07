// Arena hazards that keep a fight moving:
//  - the Sweeper: a spinning arm from the centre to the edge that bats balls
//    around, getting faster as the round goes on
//  - three pinball bumpers that slowly orbit and fire balls away on contact
// Both scale with the shrinking arena. Bumpers vanish once the arena is too
// small for them.
import Phaser from 'phaser';
import type { Layout } from '../layout.ts';
import { THEME } from '../theme.ts';

const ARM_THICKNESS = 32;
const ARM_REACH = 0.72; // arm length as a fraction of the arena's current size
const SWEEPER_APPEARS_MS = 8000;
/** Rotation speed in radians per physics step, at the start and end of a fight. */
const OMEGA_MIN = 0.008;
const OMEGA_MAX = 0.024;
const BUMPER_COUNT = 3;
const BUMPER_ORBIT = 0.004; // radians per step
const BUMPERS_GONE_BELOW = 0.32; // fraction of the starting arena size

interface Bumper {
  body: MatterJS.BodyType;
  angle: number;
  pop: number;
}

export class Hazards {
  private scene: Phaser.Scene;
  private layout: Layout;
  private gfx: Phaser.GameObjects.Graphics;
  private arm: MatterJS.BodyType | undefined;
  private armLength = 0;
  private angle = 0;
  /** +1 or -1: which way the Sweeper turns. */
  dir = 1;
  omega = 0;
  private bumpers: Bumper[] = [];
  private active = false;
  private fightMs = 0;
  /** Called the moment the Sweeper first appears in a fight. */
  onSweeperAppears: () => void = () => {};

  constructor(scene: Phaser.Scene, layout: Layout) {
    this.scene = scene;
    this.layout = layout;
    this.gfx = scene.add.graphics().setDepth(6);
  }

  get sweeperOn(): boolean {
    return this.arm !== undefined;
  }

  start(): void {
    this.stop();
    this.active = true;
    this.fightMs = 0;
    this.angle = Math.random() * Math.PI * 2;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    const { x, y, radius: R } = this.layout.arena;
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < BUMPER_COUNT; i++) {
      const angle = base + (i * Math.PI * 2) / BUMPER_COUNT;
      const body = this.scene.matter.add.circle(x + Math.cos(angle) * R * 0.5, y + Math.sin(angle) * R * 0.5, R * 0.07, {
        isStatic: true,
        label: 'bumper',
        restitution: 1,
      });
      this.bumpers.push({ body, angle, pop: 0 });
    }
  }

  stop(): void {
    this.active = false;
    if (this.arm) this.scene.matter.world.remove(this.arm);
    this.arm = undefined;
    for (const b of this.bumpers) this.scene.matter.world.remove(b.body);
    this.bumpers = [];
    this.gfx.clear();
  }

  /** Advance one physics step. `intensity` (about 0.3 to 1.6) comes from the game's pacing. */
  step(stepMs: number, arenaR: number, intensity: number, roundProgress: number): void {
    if (!this.active) return;
    this.fightMs += stepMs;
    const { x: cx, y: cy, radius: R0 } = this.layout.arena;

    // Sweeper
    if (this.fightMs >= SWEEPER_APPEARS_MS) {
      // Stops short of the edge, so it bats balls around rather than flicking them straight out.
      const wanted = Math.max(arenaR * ARM_REACH, R0 * 0.08);
      if (!this.arm) this.onSweeperAppears();
      if (!this.arm || Math.abs(wanted - this.armLength) / this.armLength > 0.04) {
        if (this.arm) this.scene.matter.world.remove(this.arm);
        this.armLength = wanted;
        this.arm = this.scene.matter.add.rectangle(cx, cy, this.armLength, ARM_THICKNESS, { isStatic: true, label: 'sweeper', chamfer: { radius: ARM_THICKNESS / 2 } });
      }
      this.omega = (OMEGA_MIN + (OMEGA_MAX - OMEGA_MIN) * roundProgress) * Phaser.Math.Clamp(intensity, 0.4, 1.4);
      this.angle += this.omega * this.dir;
      const mx = cx + (Math.cos(this.angle) * this.armLength) / 2;
      const my = cy + (Math.sin(this.angle) * this.armLength) / 2;
      this.scene.matter.body.setPosition(this.arm, { x: mx, y: my }, false);
      this.scene.matter.body.setAngle(this.arm, this.angle, false);
    }

    // Bumpers orbit slowly and follow the shrinking arena, until there's no room.
    const keep = arenaR > R0 * BUMPERS_GONE_BELOW;
    for (const b of this.bumpers) {
      b.pop *= 0.85;
      if (!keep) continue;
      b.angle += BUMPER_ORBIT * this.dir * -1;
      this.scene.matter.body.setPosition(b.body, { x: cx + Math.cos(b.angle) * arenaR * 0.5, y: cy + Math.sin(b.angle) * arenaR * 0.5 }, false);
    }
    if (!keep && this.bumpers.length) {
      for (const b of this.bumpers) this.scene.matter.world.remove(b.body);
      this.bumpers = [];
    }
  }

  /** How a ball touching the Sweeper should move: along the arm's direction of travel. */
  sweeperPush(bx: number, by: number): { tx: number; ty: number; armSpeed: number } {
    const { x: cx, y: cy } = this.layout.arena;
    const d = Math.hypot(bx - cx, by - cy);
    return { tx: -Math.sin(this.angle) * this.dir, ty: Math.cos(this.angle) * this.dir, armSpeed: this.omega * d };
  }

  bumperHit(body: MatterJS.BodyType): void {
    const b = this.bumpers.find((x) => x.body === body);
    if (b) b.pop = 0.45;
  }

  draw(): void {
    const g = this.gfx.clear();
    if (!this.active) return;
    const { x: cx, y: cy, radius: R0 } = this.layout.arena;
    for (const b of this.bumpers) {
      const r = R0 * 0.07 * (1 + b.pop);
      const { x, y } = b.body.position;
      g.fillStyle(THEME.outline).fillCircle(x, y, r + 7);
      g.fillStyle(THEME.good).fillCircle(x, y, r);
      g.lineStyle(5, THEME.outline).strokeCircle(x, y, r * 0.62);
      g.fillStyle(0xffffff).fillCircle(x, y, r * 0.38);
    }
    if (this.arm) {
      // A see-through wedge trailing behind the arm, so its sweep reads at a glance.
      const trail = 0.55;
      g.fillStyle(THEME.accent, 0.16);
      g.slice(cx, cy, this.armLength, this.angle - trail * this.dir, this.angle, this.dir < 0);
      g.fillPath();
      const ex = cx + Math.cos(this.angle) * this.armLength;
      const ey = cy + Math.sin(this.angle) * this.armLength;
      g.lineStyle(ARM_THICKNESS + 10, THEME.outline).lineBetween(cx, cy, ex, ey);
      g.fillStyle(THEME.outline).fillCircle(ex, ey, (ARM_THICKNESS + 10) / 2);
      g.lineStyle(ARM_THICKNESS, THEME.accent).lineBetween(cx, cy, ex, ey);
      g.fillStyle(THEME.accent).fillCircle(ex, ey, ARM_THICKNESS / 2);
      g.fillStyle(THEME.outline).fillCircle(cx, cy, ARM_THICKNESS * 0.9);
      g.fillStyle(THEME.edge).fillCircle(cx, cy, ARM_THICKNESS * 0.55);
    }
  }
}
