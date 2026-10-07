// The whole game loop:
//   join (45s) -> fight (edge shrinks until one ball is left) -> podium (10s) -> countdown (5s) -> join ...
import Phaser from 'phaser';
import { DEFAULT_CONFIG, type GameConfig } from '../../shared/config.ts';
import { defaultColourFor, PALETTE, type ColourName } from '../../shared/palette.ts';
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
import { Sfx } from '../audio/Sfx.ts';
import { Ball } from './Ball.ts';
import { Effects } from './Effects.ts';
import { Hazards } from './Hazards.ts';
import { pickBotNames } from './bots.ts';
import { PaidHooks, type GameApi } from './paidEvents.ts';

type Phase = 'join' | 'fight' | 'podium' | 'countdown' | 'ended';

// Movement tuning, in pixels per physics step (1/60 s).
const WANDER = 0.06; // each ball's own random wandering
// Pull towards the middle, scaled to the *current* arena size. The crowd
// shrinks with the arena, so balls at the edge get squeezed out by the pack.
const CENTRE_PULL = 0.15;
const MAX_SPEED = 18;
/** Every couple of seconds each ball charges at its nearest rival. */
const DASH_KICK = 3.2;
const DASH_EVERY_MS: [number, number] = [1200, 3000];
/** A hit counts as a knock-out if the ball goes out within this long. */
const KO_CREDIT_MS = 2500;
/** Knock-outs this close together make a combo (DOUBLE KO!). */
const COMBO_MS = 1500;
/** Fights aim to end around here (seconds); the pacing director steers towards it. */
const TARGET_FIGHT_S = 46;
const MIN_FIGHT_S = 30;
const BOOST_KICK = 6;
const QUAKE_KICK = 4;
/** Speed (pixels per step) at the arena's edge during a swirl. */
const SWIRL_EDGE_SPEED = 3.5;
const WINNER_BEAT_MS = 1400; // pause on the winner before the podium appears
// In crowded rounds only this many balls show full names: during a fight the
// ones nearest the edge (most at risk), while joining the newest arrivals.
// Everyone else shows initials. Full names come back once few enough are left.
const FULL_NAMES = 15;
const ALL_NAMES_UP_TO = 18;
const LABEL_UPDATE_MS = 400;
/** Physics runs in fixed steps, so a frame hitch (OBS busy, a slow PC) slows the game briefly instead of flinging balls. */
const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 4;

/** `?quick` in the URL shortens every phase, for testing. */
function quickConfig(c: GameConfig): GameConfig {
  return {
    ...c,
    round: { ...c.round, joinWindowSeconds: 12, winnerScreenSeconds: 6, countdownSeconds: 3 },
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
  private nextLabelUpdate = 0;

  private arenaGfx!: Phaser.GameObjects.Graphics;
  private vignette!: Phaser.GameObjects.Graphics;
  private hud!: Hud;
  private board!: LeaderboardPanel;
  feed!: Feed;
  toasts!: Toasts;
  private podium!: Podium;
  private bigCountdown!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  /** The show is ending: finish this round, then show the end card. */
  private ending = false;
  private statusText!: Phaser.GameObjects.Text;
  private previewTag!: Phaser.GameObjects.Text;
  private paid!: PaidHooks;
  sfx!: Sfx;
  private fx!: Effects;
  private lastTick = -1;
  /** Physics speed: 1 normally, lower during slow-motion moments. */
  private timeScale = 1;
  private stepAccumulator = 0;
  /**
   * Simulated time in ms: advances only when the physics steps (and slower in
   * slow motion). The fight's shrinking edge, timer and chaos events run on
   * this clock, so if the page stalls, everything pauses together.
   */
  private simTime = 0;
  private fightStart = 0;
  private hazards!: Hazards;
  private ballByBody = new Map<MatterJS.BodyType, Ball>();
  /** How hard everything pushes right now: the round's ramp-up times the pacing director's adjustment. */
  private intensity = 1;
  /** Pacing director: below 1 calms things when players go out too fast, above 1 livens up a stalled round. */
  private pace = 1;
  private roundProgress = 0;
  private fightCount = 0;
  private recentKos: number[] = [];

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
    this.sfx = new Sfx(this.config.audio);
    const muted = new URLSearchParams(window.location.search).has('mute');
    if (muted) this.sfx.setMuted(true);
    this.fx = new Effects(this, L.width, L.height);
    this.paid = new PaidHooks(this);
    this.board.setEntries([]);

    this.hazards = new Hazards(this, L);
    this.hazards.onSweeperAppears = () => {
      this.announce('SWEEPER!', THEME.textAccent);
      this.sfx.sweeper();
    };
    this.matter.world.on('collisionstart', (e: Phaser.Physics.Matter.Events.CollisionStartEvent) => this.onContacts(e.pairs, true));
    this.matter.world.on('collisionactive', (e: Phaser.Physics.Matter.Events.CollisionActiveEvent) => this.onContacts(e.pairs, false));

    const b = L.joinBanner;
    this.add.graphics().setDepth(50).fillStyle(THEME.accent).fillRoundedRect(b.x, b.y, b.w, b.h, 24).lineStyle(6, THEME.outline).strokeRoundedRect(b.x, b.y, b.w, b.h, 24);
    this.bannerText = bigText(this, b.x + b.w / 2, b.y + b.h / 2, 'Type !join to play', L.bannerFontSize).setOrigin(0.5).setDepth(51);

    this.bigCountdown = bigText(this, L.arena.x, L.arena.y, '', 240, THEME.textAccent).setOrigin(0.5).setDepth(65);
    this.statusText = bigText(this, L.width - 20, L.height - 12, '', 22, THEME.textDanger).setOrigin(1, 1).setDepth(90);
    this.previewTag = bigText(this, 20, L.height - 12, 'PREVIEW · results not saved', 22, THEME.textDim).setOrigin(0, 1).setDepth(90).setVisible(false);

    if (new URLSearchParams(window.location.search).has('safe')) this.drawCoveredAreas();

    // A normal browser tab keeps sound off until you click once. (OBS doesn't need this.)
    const unlock = bigText(this, L.width / 2, L.height - 40, '🔇 Click anywhere for sound', 26, THEME.textDim).setOrigin(0.5, 1).setDepth(90);
    unlock.setVisible(!muted && this.sfx.blocked);
    this.input.on('pointerdown', () => {
      this.sfx.resume();
      unlock.setVisible(false);
    });
    this.time.delayedCall(1000, () => unlock.setVisible(!muted && this.sfx.blocked));

    this.net.onState((state) => this.statusText.setText(state === 'open' ? '' : '● waiting for server…'));
    this.net.onMessage((msg) => this.handleServer(msg));

    this.startJoin();
  }

  // ---------------------------------------------------------------- server messages

  private handleServer(msg: ServerToGame): void {
    switch (msg.type) {
      case 'hello':
        this.config = this.quick ? quickConfig(msg.config) : msg.config;
        this.sfx.setSettings(this.config.audio);
        this.serverNextRound = msg.nextRound;
        this.setPrimary(msg.primary);
        // If nothing has finished on this page yet, adopt the server's round number.
        if (this.roundsPlayedHere === 0 && this.phase === 'join') {
          this.round = msg.nextRound;
          this.hud.setRound(this.round);
        }
        if (msg.ending) this.beginEnding();
        break;
      case 'endStream':
        this.beginEnding();
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
        if (command.colour) this.colourPrefs.set(viewer.id, command.colour); // saved from an earlier stream
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
    if (this.ending) return;
    if (this.byId.has(viewer.id) && this.phase !== 'podium' && this.phase !== 'countdown') return;
    if (this.phase === 'join' && this.balls.length < this.config.round.maxPlayers) {
      this.spawn(viewer, false);
      this.sfx.join();
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
    this.sfx.boost();
    this.fx.boost(ball.x, ball.y, Math.cos(a), Math.sin(a));
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
    this.ballByBody.set(ball.body, ball);

    // "Drop in" from above the camera.
    ball.dropScale = 2.6;
    this.tweens.add({ targets: ball, dropScale: 1, duration: 520, ease: 'Bounce.easeOut' });
    // Puff of dust when it first touches down (the bounce ease lands about 40% of the way in).
    this.time.delayedCall(200, () => {
      if (ball.out) return;
      this.fx.landing(ball.x, ball.y, ball.radius);
      if (!isBot || this.phase !== 'join') this.sfx.land();
    });
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

  /** Option (c) for crowded rounds: full names for the 15 that matter most right now, initials for the rest. */
  private updateLabels(): void {
    const alive = this.alive();
    if (alive.length <= ALL_NAMES_UP_TO) {
      for (const b of alive) b.setShortLabel(false);
      return;
    }
    const { x: cx, y: cy } = this.layout.arena;
    const ranked =
      this.phase === 'join'
        ? [...alive].reverse() // newest first, so people see their own name land
        : [...alive].sort((a, z) => Math.hypot(z.x - cx, z.y - cy) - Math.hypot(a.x - cx, a.y - cy));
    ranked.forEach((b, i) => b.setShortLabel(i >= FULL_NAMES));
  }

  /** ?safe: shade the areas YouTube's phone player usually covers. */
  private drawCoveredAreas(): void {
    const g = this.add.graphics().setDepth(95);
    for (const c of this.layout.covered) {
      g.fillStyle(0xff00ff, 0.25).fillRect(c.x, c.y, c.w, c.h);
      g.lineStyle(4, 0xff00ff, 0.9).strokeRect(c.x, c.y, c.w, c.h);
      bigText(this, c.x + 12, c.y + 8, `covered: ${c.label}`, 22, '#ff9cff').setDepth(96);
    }
  }

  private alive(): Ball[] {
    return this.balls.filter((b) => !b.out);
  }

  private clearBalls(): void {
    for (const b of this.balls) b.destroy();
    this.balls = [];
    this.byId.clear();
    this.ballByBody.clear();
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
    this.fightStart = this.simTime;
    this.nextChaosAt = this.simTime + Phaser.Math.Between(c.minGapSeconds, c.maxGapSeconds) * 1000;
    this.fightCount = this.balls.length;
    this.pace = 1;
    this.intensity = 0.45;
    this.roundProgress = 0;
    this.recentKos = [];
    // Everyone starts safely inside the arena.
    const { x: cx, y: cy, radius: R0 } = this.layout.arena;
    for (const b of this.balls) {
      b.nextDash = this.simTime + Phaser.Math.Between(400, 2500);
      const d = Math.hypot(b.x - cx, b.y - cy);
      if (d > R0 * 0.8) this.matter.body.setPosition(b.body, { x: cx + ((b.x - cx) / d) * R0 * 0.75, y: cy + ((b.y - cy) / d) * R0 * 0.75 }, false);
    }
    this.hazards.start();
    this.hud.setPhase('FIGHT!', THEME.textAccent);
    this.announce('FIGHT!', THEME.textAccent);
    this.sfx.go();
  }

  private endRound(winner: Ball): void {
    if (this.log) console.log(`[round ${this.round}] winner ${winner.viewer.name}, fight lasted ${((this.simTime - this.fightStart) / 1000).toFixed(1)}s`);
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
    this.sfx.win();
    this.fx.flash(0xffffff, 0.5, 300);
    this.slowMo(0.3, 900);
    const { x: ax, y: ay, radius: aR } = this.layout.arena;
    this.time.delayedCall(WINNER_BEAT_MS, () => this.fx.confetti(ax, ay - aR, aR * 2));
    this.tweens.add({ targets: winner, dropScale: 1.6, duration: 500, ease: 'Back.easeOut' });
    const places = order.slice(0, 3).map((b) => ({ name: b.viewer.name, colour: b.colour, isBot: b.isBot }));
    const koKing = [...this.balls].sort((a, z) => z.kos - a.kos)[0];
    const koLine = koKing && koKing.kos >= 2 ? `Most KOs: ${clip(koKing.viewer.name, 14)} (${koKing.kos})` : undefined;
    this.hazards.stop();
    this.time.delayedCall(WINNER_BEAT_MS, () => {
      if (this.phase !== 'podium') return;
      this.clearBalls();
      this.resetArena();
      this.podium.show(this.round, places, koLine);
    });
  }

  // ---------------------------------------------------------------- ending the show

  /** Finish whatever is happening, then show the end card. */
  private beginEnding(): void {
    if (this.ending) return;
    this.ending = true;
    this.queue = [];
    switch (this.phase) {
      case 'join':
        // Start the fight now with whoever has joined; with nobody, go straight to the end.
        if (this.balls.some((b) => !b.isBot)) {
          this.announce('LAST ROUND!', THEME.textAccent);
          this.startFight();
        } else this.showEndCard();
        break;
      case 'fight':
        this.announce('LAST ROUND!', THEME.textAccent);
        break;
      case 'countdown':
        this.showEndCard();
        break;
      default:
        break; // podium: the update loop shows the end card when it finishes
    }
  }

  private showEndCard(): void {
    this.phase = 'ended';
    this.clearBalls();
    this.podium.hide();
    this.resetArena();
    this.bigCountdown.setText('');
    this.hud.setPhase('THAT\'S ALL!', THEME.textAccent);
    this.hud.setTimer('');
    this.hud.setAlive('');
    this.bannerText.setText('Thanks for playing!');
    this.sfx.ending();

    const { x, y, radius: R } = this.layout.arena;
    const card = this.add.container(0, 0).setDepth(60);
    card.add(this.add.circle(x, y, R + 10, THEME.panel, 0.94));
    card.add(bigText(this, x, y - R * 0.3, 'THANKS FOR\nPLAYING!', 92, THEME.textAccent).setOrigin(0.5).setAlign('center'));
    card.add(bigText(this, x, y + R * 0.22, 'Back next stream.\nSubscribe so you don\'t miss it!', 40).setOrigin(0.5).setAlign('center'));
    card.setAlpha(0);
    this.tweens.add({ targets: card, alpha: 1, duration: 500 });
    this.net.send({ type: 'ended' });
  }

  /** Tick each second for the last 5 seconds of a countdown. */
  private countdownTick(left: number): void {
    const s = Math.ceil(left);
    if (s > 5 || s < 1 || s === this.lastTick) return;
    this.lastTick = s;
    this.sfx.tick(s === 1);
  }

  /** Slow the physics down for a dramatic moment, then speed back up. */
  private slowMo(scale: number, ms: number): void {
    const timing = this.matter.world.engine.timing;
    this.timeScale = scale;
    timing.timeScale = scale;
    this.time.delayedCall(ms, () => {
      this.timeScale = 1;
      timing.timeScale = 1;
    });
  }

  private resetArena(): void {
    this.hazards?.stop();
    this.sfx?.stopHeartbeat();
    this.sfx?.music.restore();
    this.lastTick = -1;
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
    const left = (this.phaseEnd - now) / 1000;

    switch (this.phase) {
      case 'join':
        this.hud.setTimer(left, left <= 10);
        this.hud.setAlive(`${this.balls.length} / ${this.config.round.maxPlayers} joined`);
        this.countdownTick(left);
        if (left <= 0) this.startFight();
        break;
      case 'fight':
        this.updateFight(this.simTime);
        break;
      case 'podium': {
        this.hud.setTimer('');
        const untilNext = left + this.config.round.countdownSeconds;
        this.podium.setCountdown(this.ending ? 'That was the last round!' : `Next round in ${Math.ceil(untilNext)}s · type !join`);
        if (left <= 0) {
          if (this.ending) this.showEndCard();
          else this.startCountdown();
        }
        break;
      }
      case 'countdown':
        this.hud.setTimer(left);
        this.bigCountdown.setText(String(Math.max(1, Math.ceil(left))));
        this.countdownTick(left);
        if (left <= 0) this.startJoin();
        break;
    }

    // Fixed physics steps: the same speed at 30 or 60 fps, and no huge jumps after a hitch.
    const moving = this.phase === 'join' || this.phase === 'fight' || this.phase === 'podium';
    this.stepAccumulator += Math.min(delta, 250);
    let steps = 0;
    while (this.stepAccumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      if (moving) this.moveBalls(this.timeScale, this.simTime);
      if (this.phase === 'fight') this.hazards.step(STEP_MS * this.timeScale, this.arenaR, this.intensity, this.roundProgress);
      this.matter.world.step(STEP_MS);
      this.simTime += STEP_MS * this.timeScale;
      this.stepAccumulator -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.stepAccumulator = 0; // too far behind: drop the backlog
    if (now >= this.nextLabelUpdate) {
      this.nextLabelUpdate = now + LABEL_UPDATE_MS;
      this.updateLabels();
    }
    for (const b of this.balls) if (!b.out) b.sync();
    this.drawArena(now);
    this.hazards.draw();
  }

  private updateFight(now: number): void {
    const { shrinkDelaySeconds: delay, shrinkDurationSeconds: duration } = this.config.arena;
    const elapsed = (now - this.fightStart) / 1000;
    const progress = Phaser.Math.Clamp((elapsed - delay) / duration, 0, 1);
    this.arenaR = this.layout.arena.radius * (1 - progress);

    this.roundProgress = Phaser.Math.Clamp(elapsed / (delay + duration), 0, 1);
    this.updatePacing(elapsed);

    const closesIn = delay + duration - elapsed;
    this.hud.setTimer(closesIn, closesIn <= 10);
    if (!this.finalTwo) this.hud.setPhase(elapsed < delay ? 'FIGHT!' : 'ARENA SHRINKING', elapsed < delay ? THEME.textAccent : THEME.text);

    if (now >= this.nextChaosAt) {
      this.chaosEvent();
      const c = this.config.chaos;
      this.nextChaosAt = now + (Phaser.Math.FloatBetween(c.minGapSeconds, c.maxGapSeconds) * 1000) / this.pace;
    }

    // Anyone whose centre is past the edge is out. If that would knock out
    // everyone left, the ball nearest the centre survives and wins.
    const { x: cx, y: cy } = this.layout.arena;
    const alive = this.alive();
    const outside = alive
      .map((b) => ({ b, d: Math.hypot(b.x - cx, b.y - cy) }))
      .filter((o) => o.d > this.arenaR + o.b.radius * 0.4) // a little grace: partly over the edge
      .sort((a, z) => z.d - a.d);
    if (outside.length === alive.length) outside.pop();
    for (const { b } of outside) this.eliminate(b);

    const remaining = this.alive();
    this.hud.setAlive(`${remaining.length} left`);
    if (remaining.length === 2 && !this.finalTwo) this.startFinalTwo(remaining);
    if (remaining.length <= 1) this.endRound(remaining[0]);
  }

  // ---------------------------------------------------------------- action: dashes, hazards, knock-outs

  /** Charge at the nearest rival (with a little wobble), so balls keep crashing into each other. */
  private dash(b: Ball, now: number): void {
    const [lo, hi] = DASH_EVERY_MS;
    b.nextDash = now + Phaser.Math.Between(lo, hi) / Math.max(0.4, this.intensity);
    let target: Ball | undefined;
    let best = Infinity;
    for (const o of this.balls) {
      if (o === b || o.out) continue;
      const d = (o.x - b.x) ** 2 + (o.y - b.y) ** 2;
      if (d < best) {
        best = d;
        target = o;
      }
    }
    const a = target ? Math.atan2(target.y - b.y, target.x - b.x) + Phaser.Math.FloatBetween(-0.35, 0.35) : Math.random() * Math.PI * 2;
    const f = DASH_KICK * this.intensity;
    b.kick(Math.cos(a) * f, Math.sin(a) * f);
  }

  private onContacts(pairs: { bodyA: MatterJS.BodyType; bodyB: MatterJS.BodyType }[], first: boolean): void {
    if (this.phase !== 'fight') return;
    for (const { bodyA, bodyB } of pairs) {
      const a = this.ballByBody.get(bodyA);
      const b = this.ballByBody.get(bodyB);
      if (a && b) {
        if (!first) continue;
        const rel = Math.hypot(bodyA.velocity.x - bodyB.velocity.x, bodyA.velocity.y - bodyB.velocity.y);
        this.sfx.bump(rel / 8);
        if (rel > 2) {
          a.lastHitBy = b;
          b.lastHitBy = a;
          a.lastHazard = b.lastHazard = undefined;
          a.lastHitAt = b.lastHitAt = this.simTime;
        }
        if (rel > 8) this.fx.hit((a.x + b.x) / 2, (a.y + b.y) / 2);
        continue;
      }
      const ball = a ?? b;
      const other = a ? bodyB : bodyA;
      if (!ball || ball.out) continue;
      if (other.label === 'sweeper') this.sweeperHit(ball, first);
      else if (other.label === 'bumper' && first) this.bumperHit(ball, other);
    }
  }

  /** The Sweeper carries the ball along in the direction it's turning, a bit faster than the arm. */
  private sweeperHit(ball: Ball, first: boolean): void {
    const { tx, ty, armSpeed } = this.hazards.sweeperPush(ball.x, ball.y);
    const v = ball.body.velocity;
    const target = armSpeed + 0.8 * this.intensity;
    const dv = Math.max(0, target - (v.x * tx + v.y * ty));
    ball.kick(tx * dv, ty * dv);
    if (first) {
      this.sfx.bump(1);
      ball.lastHazard = 'sweeper';
      ball.lastHitBy = undefined;
      ball.lastHitAt = this.simTime;
    }
  }

  private bumperHit(ball: Ball, bumper: MatterJS.BodyType): void {
    const dx = ball.x - bumper.position.x;
    const dy = ball.y - bumper.position.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const f = 5.5 * Math.max(0.6, this.intensity);
    this.matter.body.setVelocity(ball.body, { x: (dx / d) * f, y: (dy / d) * f });
    this.hazards.bumperHit(bumper);
    this.sfx.bumper();
    this.fx.hit(bumper.position.x + (dx / d) * ball.radius, bumper.position.y + (dy / d) * ball.radius, THEME.good);
    ball.lastHazard = 'bumper';
    ball.lastHitBy = undefined;
    ball.lastHitAt = this.simTime;
  }

  /**
   * Pacing director. Compares how many are left with where a ~40 s fight
   * should be, and eases everything up or down so fights land between about
   * 30 and 50 seconds whatever the crowd size. Early on things also start
   * gentler and build up.
   */
  private updatePacing(elapsed: number): void {
    const alive = this.alive().length;
    const expected = 1 - Math.min(1, elapsed / TARGET_FIGHT_S) ** 1.6;
    const actual = alive / Math.max(1, this.fightCount);
    let target = 1;
    if (actual < expected - 0.12) target = 0.25;
    else if (actual > expected + 0.12) target = 1.6;
    if (elapsed < MIN_FIGHT_S + 4 && alive <= 4) target = Math.min(target, 0.3);
    this.pace += (target - this.pace) * 0.03;
    const ramp = 0.45 + 0.55 * Math.min(1, elapsed / 24);
    this.intensity = ramp * this.pace;
  }

  /** Say who knocked whom out, and call out combos. */
  private creditKnockout(ball: Ball, place: number): void {
    const name = clip(ball.viewer.name, 14);
    const recent = this.simTime - ball.lastHitAt < KO_CREDIT_MS;
    const by = recent ? ball.lastHitBy : undefined;
    if (by && !by.out) {
      by.kos++;
      this.feed.push(`${clip(by.viewer.name, 12)} bonked ${name} out!`, by.isBot ? THEME.textDim : THEME.textAccent);
      this.popText(by.x, by.y - by.radius - 40, by.kos > 1 ? `${by.kos} KOs` : '+1 KO', THEME.textAccent, 30);
    } else if (recent && ball.lastHazard === 'sweeper') {
      this.feed.push(`${name} got swept out!`, ball.isBot ? THEME.textDim : THEME.textDanger);
    } else if (recent && ball.lastHazard === 'bumper') {
      this.feed.push(`${name} got bumped out!`, ball.isBot ? THEME.textDim : THEME.textDanger);
    } else {
      this.feed.push(`${name} out #${place}`, ball.isBot ? THEME.textDim : THEME.textDanger);
    }

    this.recentKos = this.recentKos.filter((t) => this.simTime - t < COMBO_MS);
    this.recentKos.push(this.simTime);
    const n = this.recentKos.length;
    if (n >= 2 && place > 2) {
      this.announce(n === 2 ? 'DOUBLE KO!' : n === 3 ? 'TRIPLE KO!' : 'MEGA KO!', THEME.textAccent);
      this.sfx.combo(n);
    }
  }

  private eliminate(ball: Ball): void {
    const place = this.alive().length;
    this.eliminated.push(ball);
    const big = place <= 4;
    this.fx.elimination(ball.x, ball.y, PALETTE[ball.colour], big);
    this.sfx.eliminate(big);
    this.cameras.main.shake(big ? 320 : 160, big ? 0.009 : 0.004);
    if (!ball.isBot) this.popText(ball.x, ball.y - ball.radius - 30, 'OUT!', THEME.textDanger, big ? 44 : 32);
    ball.eliminate();
    this.creditKnockout(ball, place);
    if (this.log) {
      const t = (this.simTime - this.fightStart) / 1000;
      const cause = this.simTime - ball.lastHitAt < KO_CREDIT_MS ? (ball.lastHazard ?? 'ball') : 'edge';
      console.log(`[elim] t=${t.toFixed(1)}s edge=${(this.arenaR / this.layout.arena.radius).toFixed(2)} place=${place} cause=${cause}`);
    }
  }

  private startFinalTwo(pair: Ball[]): void {
    this.finalTwo = true;
    this.hud.setPhase('FINAL TWO', THEME.textDanger);
    this.announce('FINAL TWO!', THEME.textDanger);
    for (const b of pair) b.showHp();
    this.sfx.finalTwo();
    this.fx.flash(THEME.danger, 0.35, 400);
    this.slowMo(0.35, 1200);
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
        // Turn the pack like a spinning platter: nudge each ball's sideways
        // speed towards a target (faster further out) instead of piling on
        // speed, which would fling everyone off at once.
        const tx = (-dy / d) * this.swirl.dir;
        const ty = (dx / d) * this.swirl.dir;
        const v = b.body.velocity;
        const current = v.x * tx + v.y * ty;
        const target = (SWIRL_EDGE_SPEED / Math.max(R, R0 * 0.2)) * d * this.chaosStrength();
        const dv = (target - current) * 0.06;
        ax += tx * dv;
        ay += ty * dv;
      }
      b.kick(ax * k, ay * k);
      if (this.phase === 'fight' && now >= b.nextDash) this.dash(b, now);

      const v = b.body.velocity;
      const speed = Math.hypot(v.x, v.y);
      if (speed > MAX_SPEED) this.matter.body.setVelocity(b.body, { x: (v.x / speed) * MAX_SPEED, y: (v.y / speed) * MAX_SPEED });
    }
  }

  // ---------------------------------------------------------------- chaos events

  private chaosEvent(): void {
    // ?chaos=shockwave|swirl|quake forces one kind, for testing.
    const forced = ['shockwave', 'swirl', 'quake'].indexOf(new URLSearchParams(window.location.search).get('chaos') ?? '');
    const pick = forced >= 0 ? forced : Phaser.Math.Between(0, 2);
    if (this.log) console.log(`[chaos] t=${((this.simTime - this.fightStart) / 1000).toFixed(1)}s ${['shockwave', 'swirl', 'quake'][pick]}`);
    if (pick === 0) this.shockwave();
    else if (pick === 1) {
      this.swirl = { until: this.simTime + 3500, dir: Math.random() < 0.5 ? -1 : 1 };
      this.announce('SWIRL!', THEME.textGood);
      this.sfx.swirl();
    } else {
      const strength = this.chaosStrength();
      this.announce('QUAKE!', THEME.textAccent);
      this.sfx.quake();
      this.cameras.main.shake(500, 0.008);
      for (const b of this.alive()) {
        const a = Math.random() * Math.PI * 2;
        b.kick(Math.cos(a) * QUAKE_KICK * strength, Math.sin(a) * QUAKE_KICK * strength);
      }
    }
  }

  /**
   * Chaos gets gentler as the arena shrinks. A full-strength blast in a small
   * arena would knock out the whole pack at once and end the round early.
   */
  private chaosStrength(): number {
    return (0.45 + 0.55 * (this.arenaR / this.layout.arena.radius)) * this.intensity;
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
    this.sfx.warn();

    const warn = this.add.circle(px, py, 40).setStrokeStyle(10, THEME.danger).setDepth(5);
    this.tweens.add({ targets: warn, scale: 1.6, alpha: 0.3, yoyo: true, repeat: 2, duration: 150 });
    this.time.delayedCall(900, () => {
      warn.destroy();
      if (this.phase !== 'fight') return;
      const ring = this.add.circle(px, py, 30).setStrokeStyle(14, THEME.danger).setDepth(5);
      this.tweens.add({ targets: ring, radius: range, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
      this.cameras.main.shake(300, 0.01);
      this.sfx.shockwave();
      this.fx.flash(THEME.danger, 0.18, 250);
      for (const b of this.alive()) {
        const dx = b.x - px;
        const dy = b.y - py;
        const dist = Math.max(1, Math.hypot(dx, dy));
        if (dist > range) continue;
        const f = (5 * (1 - dist / range) + 1) * this.chaosStrength();
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
