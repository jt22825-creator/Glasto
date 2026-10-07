// The whole game loop:
//   join (45s) -> fight (edge shrinks until one ball is left) -> podium (10s) -> countdown (5s) -> join ...
import Phaser from 'phaser';
import { DEFAULT_CONFIG, type GameConfig } from '../../shared/config.ts';
import { defaultColourFor, type ColourName } from '../../shared/palette.ts';
import type { ChatCommand, PaidEvent, ServerToGame, Viewer } from '../../shared/protocol.ts';
import type { Layout } from '../layout.ts';
import type { Net } from '../net.ts';
import { THEME } from '../theme.ts';
import { Feed } from '../ui/Feed.ts';
import { Hud } from '../ui/Hud.ts';
import { LeaderboardPanel } from '../ui/LeaderboardPanel.ts';
import { Podium } from '../ui/Podium.ts';
import { bigText, clip } from '../ui/text.ts';
import { Toasts } from '../ui/Toasts.ts';
import { Ball } from './Ball.ts';
import { pickBotNames } from './bots.ts';
import { PaidHooks, type GameApi } from './paidEvents.ts';

type Phase = 'join' | 'fight' | 'podium' | 'countdown';

// Movement tuning, in pixels per physics step (1/60 s).
const WANDER = 0.045; // each ball's own random wandering
// Pull towards the middle, scaled to the *current* arena size. The crowd
// shrinks with the arena, so balls at the edge get squeezed out by the pack.
const CENTRE_PULL = 0.1;
const MAX_SPEED = 16;
const BOOST_KICK = 6;
const QUAKE_KICK = 4;
const WINNER_BEAT_MS = 1400; // pause on the winner before the podium appears

/** `?quick` in the URL shortens every phase, for testing. */
function quickConfig(c: GameConfig): GameConfig {
  return {
    ...c,
    round: { ...c.round, joinWindowSeconds: 12, winnerScreenSeconds: 6, countdownSeconds: 3 },
    arena: { shrinkDelaySeconds: 3, shrinkDurationSeconds: 40 },
    chaos: { minGapSeconds: 5, maxGapSeconds: 8 },
  };
}

export class GameScene extends Phaser.Scene implements GameApi {
  private layout: Layout;
  private net: Net;
  private quick: boolean;
  /** `?log` in the URL prints round timings to the browser console, for tuning. */
  private log = new URLSearchParams(window.location.search).has('log');
  private config: GameConfig;

  private primary = true;
  private serverNextRound = 1;
  private roundsPlayedHere = 0;
  round = 1;
  phase: Phase = 'join';
  private phaseStart = 0;
  private phaseEnd = 0;

  private balls: Ball[] = [];
  private byId = new Map<string, Ball>();
  private eliminated: Ball[] = [];
  private queue: Viewer[] = [];
  private colourPrefs = new Map<string, ColourName>();

  private arenaR = 0;
  private nextChaosAt = 0;
  private swirl = { until: 0, dir: 1 };
  private finalTwo = false;
  private lastAnnounce: Phaser.GameObjects.Text | undefined;
  private lastWinnerId: string | undefined;

  private arenaGfx!: Phaser.GameObjects.Graphics;
  private vignette!: Phaser.GameObjects.Graphics;
  private hud!: Hud;
  private board!: LeaderboardPanel;
  feed!: Feed;
  toasts!: Toasts;
  private podium!: Podium;
  private bigCountdown!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private previewTag!: Phaser.GameObjects.Text;
  private paid!: PaidHooks;

  constructor(layout: Layout, net: Net, quick: boolean) {
    super('game');
    this.layout = layout;
    this.net = net;
    this.quick = quick;
    this.config = quick ? quickConfig(DEFAULT_CONFIG) : DEFAULT_CONFIG;
  }

  // ---------------------------------------------------------------- setup

  create(): void {
    const L = this.layout;
    this.arenaR = L.arena.radius;
    this.arenaGfx = this.add.graphics().setDepth(1);
    this.vignette = this.add.graphics().setDepth(40).setAlpha(0);
    this.vignette.lineStyle(60, THEME.danger, 1).strokeRect(0, 0, L.width, L.height);

    this.hud = new Hud(this, L);
    this.board = new LeaderboardPanel(this, L);
    this.feed = new Feed(this, L);
    this.toasts = new Toasts(this, L);
    this.podium = new Podium(this, L);
    this.paid = new PaidHooks(this);
    this.board.setEntries([]);

    const b = L.joinBanner;
    this.add.graphics().setDepth(50).fillStyle(THEME.accent).fillRoundedRect(b.x, b.y, b.w, b.h, 24).lineStyle(6, THEME.outline).strokeRoundedRect(b.x, b.y, b.w, b.h, 24);
    bigText(this, b.x + b.w / 2, b.y + b.h / 2, 'Type !join to play', L.bannerFontSize).setOrigin(0.5).setDepth(51);

    this.bigCountdown = bigText(this, L.arena.x, L.arena.y, '', 240, THEME.textAccent).setOrigin(0.5).setDepth(65);
    this.statusText = bigText(this, L.width - 20, L.height - 12, '', 22, THEME.textDanger).setOrigin(1, 1).setDepth(90);
    this.previewTag = bigText(this, 20, L.height - 12, 'PREVIEW · results not saved', 22, THEME.textDim).setOrigin(0, 1).setDepth(90).setVisible(false);

    this.net.onState((state) => this.statusText.setText(state === 'open' ? '' : '● waiting for server…'));
    this.net.onMessage((msg) => this.handleServer(msg));

    this.startJoin();
  }

  // ---------------------------------------------------------------- server messages

  private handleServer(msg: ServerToGame): void {
    switch (msg.type) {
      case 'hello':
        this.config = this.quick ? quickConfig(msg.config) : msg.config;
        this.serverNextRound = msg.nextRound;
        this.setPrimary(msg.primary);
        // If nothing has finished on this page yet, adopt the server's round number.
        if (this.roundsPlayedHere === 0 && this.phase === 'join') {
          this.round = msg.nextRound;
          this.hud.setRound(this.round);
        }
        break;
      case 'role':
        this.setPrimary(msg.primary);
        break;
      case 'command':
        this.handleCommand(msg.viewer, msg.command);
        break;
      case 'stats': {
        const s = msg.stats;
        const body =
          s.rounds === 0
            ? 'No rounds yet. Type !join!'
            : `${s.wins} ${s.wins === 1 ? 'win' : 'wins'} · ${s.rounds} ${s.rounds === 1 ? 'round' : 'rounds'}${s.streak > 1 ? `\n🔥 ${s.streak} wins in a row` : ''}`;
        this.toasts.show(clip(msg.viewer.name, 16), body, THEME.floor);
        break;
      }
      case 'leaderboard':
        this.board.setEntries(msg.entries);
        break;
      case 'roundRecorded':
        // Only show stats for our own winner (a preview tab runs different rounds).
        if (msg.winnerStats && msg.winner?.id === this.lastWinnerId && this.phase === 'podium') this.podium.setWinnerStats(msg.winnerStats);
        break;
      case 'paid':
        this.handlePaid(msg.event);
        break;
    }
  }

  private setPrimary(primary: boolean): void {
    this.primary = primary;
    this.previewTag.setVisible(!primary);
  }

  private handlePaid(event: PaidEvent): void {
    if (event.kind === 'superChat') this.paid.onSuperChat(event.amountMicros, event.currency, event.viewer, event.tier);
    else this.paid.onSponsor(event.viewer);
  }

  // ---------------------------------------------------------------- chat commands

  private handleCommand(viewer: Viewer, command: ChatCommand): void {
    switch (command.kind) {
      case 'join':
        return this.join(viewer);
      case 'boost':
        return this.boost(viewer);
      case 'colour': {
        this.colourPrefs.set(viewer.id, command.colour);
        this.byId.get(viewer.id)?.setColour(command.colour);
        return;
      }
    }
  }

  private join(viewer: Viewer): void {
    if (this.byId.has(viewer.id) && this.phase !== 'podium' && this.phase !== 'countdown') return;
    if (this.phase === 'join' && this.balls.length < this.config.round.maxPlayers) {
      this.spawn(viewer, false);
      this.feed.push(`${clip(viewer.name, 16)} joined`, THEME.text);
      this.updateRadii();
      return;
    }
    if (this.queue.some((v) => v.id === viewer.id)) return;
    this.queue.push(viewer);
    this.feed.push(`${clip(viewer.name, 14)} ▸ next round`);
  }

  private boost(viewer: Viewer): void {
    const ball = this.byId.get(viewer.id);
    if (!ball || ball.out || this.phase !== 'fight') return;
    if (ball.boostsUsed >= this.config.commands.boostsPerRound) return;
    ball.boostsUsed++;
    const a = Math.random() * Math.PI * 2;
    ball.kick(Math.cos(a) * BOOST_KICK, Math.sin(a) * BOOST_KICK);
    this.popText(ball.x, ball.y - ball.radius - 50, 'BOOST!', THEME.textGood, 30);
    this.feed.push(`${clip(viewer.name, 16)} boosted!`, THEME.textGood);
  }

  // ---------------------------------------------------------------- balls

  private spawn(viewer: Viewer, isBot: boolean): Ball {
    const { x: cx, y: cy } = this.layout.arena;
    const R = this.arenaR * 0.8;
    // Try a few spots and keep the one furthest from other balls.
    let best = { x: cx, y: cy, gap: -1 };
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * R;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      const gap = Math.min(Infinity, ...this.balls.map((b) => Math.hypot(b.x - x, b.y - y)));
      if (gap > best.gap) best = { x, y, gap };
    }
    const colour = this.colourPrefs.get(viewer.id) ?? defaultColourFor(viewer.id);
    const ball = new Ball(this, viewer, isBot, colour, best.x, best.y, this.targetRadius(this.balls.length + 1));
    this.balls.push(ball);
    this.byId.set(viewer.id, ball);

    // "Drop in" from above the camera.
    ball.dropScale = 2.6;
    this.tweens.add({ targets: ball, dropScale: 1, duration: 520, ease: 'Bounce.easeOut' });
    return ball;
  }

  /** Smaller balls when the round is busy, so everyone fits. */
  private targetRadius(count: number): number {
    const R = this.layout.arena.radius;
    return Phaser.Math.Clamp(R * Math.sqrt(0.2 / Math.max(1, count)), R * 0.055, R * 0.1);
  }

  private updateRadii(): void {
    const r = this.targetRadius(this.balls.length);
    for (const b of this.balls) b.setRadius(r);
  }

  private alive(): Ball[] {
    return this.balls.filter((b) => !b.out);
  }

  private clearBalls(): void {
    for (const b of this.balls) b.destroy();
    this.balls = [];
    this.byId.clear();
    this.eliminated = [];
  }

  // ---------------------------------------------------------------- phases

  private setPhase(phase: Phase, seconds: number): void {
    this.phase = phase;
    this.phaseStart = this.time.now;
    this.phaseEnd = this.time.now + seconds * 1000;
  }

  private startJoin(): void {
    this.clearBalls();
    this.podium.hide();
    this.bigCountdown.setText('');
    this.resetArena();
    if (this.roundsPlayedHere > 0) this.round = Math.max(this.round + 1, this.serverNextRound);
    this.hud.setRound(this.round);
    this.hud.setPhase('JOIN NOW!', THEME.textGood);
    this.setPhase('join', this.config.round.joinWindowSeconds);

    const waiting = this.queue.splice(0);
    for (const v of waiting) {
      if (this.balls.length < this.config.round.maxPlayers) this.spawn(v, false);
      else this.queue.push(v);
    }
    this.updateRadii();
  }

  private startFight(): void {
    // Fill with bots so there's always a proper scrap.
    const minBalls = Phaser.Math.Clamp(this.config.bots.minBalls, 2, this.config.round.maxPlayers);
    const needed = minBalls - this.balls.length;
    if (needed > 0) {
      const names = pickBotNames(needed);
      const r = this.targetRadius(minBalls);
      for (const b of this.balls) b.setRadius(r);
      names.forEach((name) => this.spawn({ id: `bot:${name}`, name }, true));
      this.updateRadii();
    }
    this.setPhase('fight', this.config.arena.shrinkDelaySeconds + this.config.arena.shrinkDurationSeconds);
    const c = this.config.chaos;
    this.nextChaosAt = this.time.now + Phaser.Math.Between(c.minGapSeconds, c.maxGapSeconds) * 1000;
    this.hud.setPhase('FIGHT!', THEME.textAccent);
    this.announce('FIGHT!', THEME.textAccent);
  }

  private endRound(winner: Ball): void {
    if (this.log) console.log(`[round ${this.round}] winner ${winner.viewer.name}, fight lasted ${((this.time.now - this.phaseStart) / 1000).toFixed(1)}s`);
    this.setPhase('podium', this.config.round.winnerScreenSeconds);
    this.roundsPlayedHere++;
    this.hud.setPhase('WINNER!', THEME.textAccent);
    this.hud.setAlive('');
    this.vignette.setAlpha(0);
    this.tweens.killTweensOf(this.vignette);

    this.lastWinnerId = winner.viewer.id;
    const order = [winner, ...[...this.eliminated].reverse()];
    const humans = order.filter((b) => !b.isBot).map((b) => b.viewer);
    if (this.primary) {
      this.net.send({ type: 'roundResult', round: this.round, winner: winner.isBot ? null : winner.viewer, placements: humans });
    }
    this.feed.push(`🏆 ${clip(winner.viewer.name, 16)} won!`, THEME.textAccent);


    // A short beat on the winner, then the podium.
    this.announce(`${clip(winner.viewer.name, 14)} WINS!`, THEME.textAccent);
    this.tweens.add({ targets: winner, dropScale: 1.6, duration: 500, ease: 'Back.easeOut' });
    const places = order.slice(0, 3).map((b) => ({ name: b.viewer.name, colour: b.colour, isBot: b.isBot }));
    this.time.delayedCall(WINNER_BEAT_MS, () => {
      if (this.phase !== 'podium') return;
      this.clearBalls();
      this.resetArena();
      this.podium.show(this.round, places);
    });
  }

  private resetArena(): void {
    this.finalTwo = false;
    this.swirl.until = 0;
    this.tweens.killTweensOf(this.vignette);
    this.vignette.setAlpha(0);
    this.arenaR = this.layout.arena.radius;
  }

  private startCountdown(): void {
    this.podium.hide();
    this.setPhase('countdown', this.config.round.countdownSeconds);
    this.hud.setPhase('NEXT ROUND', THEME.text);
  }

  // ---------------------------------------------------------------- per frame

  update(_time: number, delta: number): void {
    const now = this.time.now;
    const k = Math.min(3, delta / (1000 / 60));
    const left = (this.phaseEnd - now) / 1000;

    switch (this.phase) {
      case 'join':
        this.hud.setTimer(left, left <= 10);
        this.hud.setAlive(`${this.balls.length} / ${this.config.round.maxPlayers} joined`);
        if (left <= 0) this.startFight();
        break;
      case 'fight':
        this.updateFight(now);
        break;
      case 'podium': {
        this.hud.setTimer('');
        const untilNext = left + this.config.round.countdownSeconds;
        this.podium.setCountdown(`Next round in ${Math.ceil(untilNext)}s · type !join`);
        if (left <= 0) this.startCountdown();
        break;
      }
      case 'countdown':
        this.hud.setTimer(left);
        this.bigCountdown.setText(String(Math.max(1, Math.ceil(left))));
        if (left <= 0) this.startJoin();
        break;
    }

    if (this.phase === 'join' || this.phase === 'fight' || this.phase === 'podium') this.moveBalls(k, now);
    for (const b of this.balls) if (!b.out) b.sync();
    this.drawArena(now);
  }

  private updateFight(now: number): void {
    const { shrinkDelaySeconds: delay, shrinkDurationSeconds: duration } = this.config.arena;
    const elapsed = (now - this.phaseStart) / 1000;
    const progress = Phaser.Math.Clamp((elapsed - delay) / duration, 0, 1);
    this.arenaR = this.layout.arena.radius * (1 - progress);

    const closesIn = delay + duration - elapsed;
    this.hud.setTimer(closesIn, closesIn <= 10);
    if (!this.finalTwo) this.hud.setPhase(elapsed < delay ? 'FIGHT!' : 'ARENA SHRINKING', elapsed < delay ? THEME.textAccent : THEME.text);

    if (now >= this.nextChaosAt) {
      this.chaosEvent();
      const c = this.config.chaos;
      this.nextChaosAt = now + Phaser.Math.FloatBetween(c.minGapSeconds, c.maxGapSeconds) * 1000;
    }

    // Anyone whose centre is past the edge is out. If that would knock out
    // everyone left, the ball nearest the centre survives and wins.
    const { x: cx, y: cy } = this.layout.arena;
    const alive = this.alive();
    const outside = alive
      .map((b) => ({ b, d: Math.hypot(b.x - cx, b.y - cy) }))
      .filter((o) => o.d > this.arenaR)
      .sort((a, z) => z.d - a.d);
    if (outside.length === alive.length) outside.pop();
    for (const { b } of outside) this.eliminate(b);

    const remaining = this.alive();
    this.hud.setAlive(`${remaining.length} left`);
    if (remaining.length === 2 && !this.finalTwo) this.startFinalTwo(remaining);
    if (remaining.length <= 1) this.endRound(remaining[0]);
  }

  private eliminate(ball: Ball): void {
    const place = this.alive().length;
    this.eliminated.push(ball);
    ball.eliminate();
    this.feed.push(`${clip(ball.viewer.name, 16)} out #${place}`, ball.isBot ? THEME.textDim : THEME.textDanger);
    if (this.log) {
      const t = (this.time.now - this.phaseStart) / 1000;
      console.log(`[elim] t=${t.toFixed(1)}s edge=${(this.arenaR / this.layout.arena.radius).toFixed(2)} place=${place}`);
    }
  }

  private startFinalTwo(pair: Ball[]): void {
    this.finalTwo = true;
    this.hud.setPhase('FINAL TWO', THEME.textDanger);
    this.announce('FINAL TWO!', THEME.textDanger);
    for (const b of pair) b.showHp();
    this.vignette.setAlpha(0.15);
    this.tweens.add({ targets: this.vignette, alpha: 0.45, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.easeInOut' });
  }

  private moveBalls(k: number, now: number): void {
    const { x: cx, y: cy, radius: R0 } = this.layout.arena;
    const joinWall = this.phase === 'join';
    const swirling = now < this.swirl.until;
    const R = Math.max(this.arenaR, R0 * 0.05);
    for (const b of this.balls) {
      if (b.out) continue;
      b.heading += (Math.random() - 0.5) * 0.3 * k;
      let ax = Math.cos(b.heading) * WANDER;
      let ay = Math.sin(b.heading) * WANDER;

      const dx = cx - b.x;
      const dy = cy - b.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      // While joining, only a light pull, so balls spread out and names stay readable.
      const pull = joinWall ? CENTRE_PULL * 0.25 * (d / R0) : CENTRE_PULL * Math.min(1.5, d / R);
      ax += (dx / d) * pull;
      ay += (dy / d) * pull;

      // While people are joining, a soft wall keeps everyone inside.
      if (joinWall && d > R0 * 0.85) {
        const push = 0.6 * ((d - R0 * 0.85) / (R0 * 0.15));
        ax += (dx / d) * push;
        ay += (dy / d) * push;
      }
      if (swirling) {
        ax += (-dy / d) * 0.22 * this.swirl.dir;
        ay += (dx / d) * 0.22 * this.swirl.dir;
      }
      b.kick(ax * k, ay * k);

      const v = b.body.velocity;
      const speed = Math.hypot(v.x, v.y);
      if (speed > MAX_SPEED) this.matter.body.setVelocity(b.body, { x: (v.x / speed) * MAX_SPEED, y: (v.y / speed) * MAX_SPEED });
    }
  }

  // ---------------------------------------------------------------- chaos events

  private chaosEvent(): void {
    const pick = Phaser.Math.Between(0, 2);
    if (pick === 0) this.shockwave();
    else if (pick === 1) {
      this.swirl = { until: this.time.now + 3500, dir: Math.random() < 0.5 ? -1 : 1 };
      this.announce('SWIRL!', THEME.textGood);
    } else {
      this.announce('QUAKE!', THEME.textAccent);
      this.cameras.main.shake(400, 0.006);
      for (const b of this.alive()) {
        const a = Math.random() * Math.PI * 2;
        b.kick(Math.cos(a) * QUAKE_KICK, Math.sin(a) * QUAKE_KICK);
      }
    }
  }

  /** Warn with a pulsing ring, then blast every ball nearby away from that spot. */
  private shockwave(): void {
    const { x: cx, y: cy, radius: R0 } = this.layout.arena;
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * this.arenaR * 0.5;
    const px = cx + Math.cos(a) * d;
    const py = cy + Math.sin(a) * d;
    const range = R0 * 0.75;
    this.announce('SHOCKWAVE!', THEME.textDanger);

    const warn = this.add.circle(px, py, 40).setStrokeStyle(10, THEME.danger).setDepth(5);
    this.tweens.add({ targets: warn, scale: 1.6, alpha: 0.3, yoyo: true, repeat: 2, duration: 150 });
    this.time.delayedCall(900, () => {
      warn.destroy();
      if (this.phase !== 'fight') return;
      const ring = this.add.circle(px, py, 30).setStrokeStyle(14, THEME.danger).setDepth(5);
      this.tweens.add({ targets: ring, radius: range, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
      this.cameras.main.shake(250, 0.008);
      for (const b of this.alive()) {
        const dx = b.x - px;
        const dy = b.y - py;
        const dist = Math.max(1, Math.hypot(dx, dy));
        if (dist > range) continue;
        const f = 7 * (1 - dist / range) + 1;
        b.kick((dx / dist) * f, (dy / dist) * f);
      }
    });
  }

  // ---------------------------------------------------------------- drawing helpers

  private drawArena(now: number): void {
    const { x: cx, y: cy, radius: R0 } = this.layout.arena;
    const R = Math.max(0, this.arenaR);
    const g = this.arenaGfx.clear();

    // Where the edge started, so you can see how much has gone.
    g.lineStyle(4, THEME.floorLine).strokeCircle(cx, cy, R0);
    g.fillStyle(THEME.floor).fillCircle(cx, cy, R);
    g.lineStyle(3, THEME.floorLine);
    for (let rr = R0 * 0.25; rr < R; rr += R0 * 0.25) g.strokeCircle(cx, cy, rr);

    const danger = this.finalTwo || (this.phase === 'fight' && R < R0 * 0.25);
    const pulse = danger ? 0.5 + 0.5 * Math.sin(now / 90) : 1;
    g.lineStyle(14, danger ? THEME.danger : THEME.edge, danger ? 0.6 + 0.4 * pulse : 1).strokeCircle(cx, cy, R);
  }

  /** Big text that pops in the middle of the arena and fades. */
  announce(text: string, color: string): void {
    const { x, y, radius } = this.layout.arena;
    if (this.lastAnnounce) {
      this.tweens.killTweensOf(this.lastAnnounce);
      this.lastAnnounce.destroy();
    }
    const t = bigText(this, x, y - radius * 0.35, text, text.length > 14 ? 76 : 96, color).setOrigin(0.5).setDepth(45).setScale(0.4).setAlpha(0);
    this.lastAnnounce = t;
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 40, delay: 1000, duration: 350, onComplete: () => t.destroy() });
  }

  private popText(x: number, y: number, text: string, color: string, size: number): void {
    const t = bigText(this, x, y, text, size, color).setOrigin(0.5).setDepth(30);
    this.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  /** Used by paid-event hooks: is a fight running right now? */
  isFighting(): boolean {
    return this.phase === 'fight';
  }
}
