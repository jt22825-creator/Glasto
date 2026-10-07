// All game sound, synthesised with the Web Audio API: no audio files, so
// nothing to download and no licences to worry about. Each effect is a few
// oscillators or a burst of filtered noise with a quick volume envelope.
//
// OBS browser sources play audio straight away. A normal browser tab blocks
// sound until you click the page once (resume() handles that).
import { Music } from './Music.ts';

export interface AudioSettings {
  sfxVolume: number;
  musicVolume: number;
  music: boolean;
}

type Wave = OscillatorType;

export class Sfx {
  readonly ctx: BaseAudioContext;
  private master: GainNode;
  private sfxBus: GainNode;
  private noiseBuffer: AudioBuffer;
  private lastBump = 0;
  private lastPlayed = new Map<string, number>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  readonly music: Music;

  constructor(settings: AudioSettings, ctx: BaseAudioContext = new AudioContext()) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    // A gentle limiter so lots of sounds at once don't distort.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    limiter.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = settings.sfxVolume;
    this.sfxBus.connect(limiter);

    const len = ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.music = new Music(ctx, limiter, settings.musicVolume);
    if (settings.music) this.music.start();
  }

  get blocked(): boolean {
    return this.ctx instanceof AudioContext && this.ctx.state === 'suspended';
  }

  resume(): void {
    if (this.ctx instanceof AudioContext) void this.ctx.resume();
  }

  /** Apply volumes from the config (sent by the server when the game connects). */
  setSettings(settings: AudioSettings): void {
    this.sfxBus.gain.value = settings.sfxVolume;
    this.music.setVolume(settings.musicVolume);
    if (settings.music) this.music.start();
    else this.music.stop();
  }

  setMuted(muted: boolean): void {
    this.master.gain.value = muted ? 0 : 1;
  }

  // ------------------------------------------------------------ building blocks

  /** Seconds added to every sound's start time. Only used to render a preview reel offline. */
  offset = 0;

  private get now(): number {
    return this.ctx.currentTime + this.offset;
  }

  /** One oscillator note with an attack/decay envelope and optional pitch slide. */
  private tone(freq: number, dur: number, opts: { type?: Wave; gain?: number; slideTo?: number; at?: number; attack?: number } = {}): void {
    const t = this.now + (opts.at ?? 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t + dur);
    const peak = opts.gain ?? 0.3;
    const attack = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A burst of filtered noise (whooshes, booms, crowd-ish texture). */
  private noise(dur: number, opts: { type?: BiquadFilterType; freq?: number; slideTo?: number; q?: number; gain?: number; at?: number; attack?: number } = {}): void {
    const t = this.now + (opts.at ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.Q.value = opts.q ?? 1;
    f.frequency.setValueAtTime(opts.freq ?? 1000, t);
    if (opts.slideTo) f.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
    const g = this.ctx.createGain();
    const peak = opts.gain ?? 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** False if the same sound played less than `ms` ago (stops floods of joins from turning into noise). */
  private allow(name: string, ms: number): boolean {
    const t = performance.now();
    if (t - (this.lastPlayed.get(name) ?? -Infinity) < ms) return false;
    this.lastPlayed.set(name, t);
    return true;
  }

  // ------------------------------------------------------------ game sounds

  /** Someone typed !join: a bright two-note blip, a slightly different pitch each time. */
  join(): void {
    if (!this.allow('join', 70)) return;
    const base = 600 + Math.random() * 200;
    this.tone(base, 0.09, { type: 'square', gain: 0.12 });
    this.tone(base * 1.5, 0.12, { type: 'square', gain: 0.12, at: 0.07 });
  }

  /** A ball lands in the arena. */
  land(): void {
    if (!this.allow('land', 90)) return;
    this.tone(160, 0.16, { gain: 0.35, slideTo: 60 });
    this.noise(0.08, { freq: 900, gain: 0.08 });
  }

  /** Two balls collide. Rate-limited so a crowd doesn't turn into a buzz. */
  bump(strength: number): void {
    const t = performance.now();
    if (t - this.lastBump < 60 || strength < 0.15) return;
    this.lastBump = t;
    this.tone(180 + Math.random() * 120, 0.07, { type: 'triangle', gain: 0.05 + 0.12 * Math.min(1, strength) });
  }

  boost(): void {
    this.noise(0.3, { type: 'bandpass', freq: 400, slideTo: 3500, q: 2, gain: 0.6 });
    this.tone(220, 0.25, { type: 'sawtooth', gain: 0.14, slideTo: 880 });
  }

  /** A ball goes off the edge. `big` for the last few eliminations. */
  eliminate(big = false): void {
    this.tone(big ? 520 : 700, big ? 0.55 : 0.32, { type: 'triangle', gain: big ? 0.3 : 0.2, slideTo: 90 });
    this.noise(big ? 0.4 : 0.18, { freq: 2500, slideTo: 200, gain: big ? 0.25 : 0.15 });
    if (big) this.tone(70, 0.5, { gain: 0.4, slideTo: 35 });
  }

  /** The red warning ring before a shockwave. */
  warn(): void {
    for (let i = 0; i < 3; i++) this.tone(980, 0.08, { type: 'square', gain: 0.14, at: i * 0.3 });
  }

  shockwave(): void {
    this.tone(95, 0.7, { gain: 0.55, slideTo: 32 });
    this.noise(0.6, { freq: 1600, slideTo: 120, gain: 0.35 });
  }

  swirl(): void {
    this.noise(1.6, { type: 'bandpass', freq: 300, slideTo: 2400, q: 6, gain: 0.45, attack: 0.4 });
    this.tone(200, 1.4, { type: 'sine', gain: 0.16, slideTo: 600, attack: 0.3 });
  }

  quake(): void {
    this.noise(1.0, { freq: 180, slideTo: 60, gain: 0.5, attack: 0.05 });
    this.tone(48, 0.9, { gain: 0.4, slideTo: 30 });
  }

  /** Countdown tick. `last` for the final second. */
  tick(last = false): void {
    this.tone(last ? 1320 : 990, last ? 0.18 : 0.07, { type: 'square', gain: last ? 0.18 : 0.13 });
  }

  /** The fight starts: a short three-note horn. */
  go(): void {
    for (const f of [392, 494, 587]) this.tone(f, 0.55, { type: 'sawtooth', gain: 0.11, attack: 0.02 });
    this.noise(0.3, { type: 'highpass', freq: 3000, gain: 0.06 });
  }

  /** Two left: a heavy hit, the music drops away, and a heartbeat starts. */
  finalTwo(): void {
    this.tone(55, 1.2, { gain: 0.42, slideTo: 40 });
    this.noise(0.8, { freq: 800, slideTo: 100, gain: 0.2 });
    this.music.duck(0.25);
    this.stopHeartbeat();
    const beat = () => {
      this.tone(62, 0.14, { gain: 0.5, slideTo: 40 });
      this.tone(58, 0.14, { gain: 0.38, slideTo: 38, at: 0.22 });
    };
    beat();
    this.heartbeat = setInterval(beat, 820);
  }

  stopHeartbeat(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  /** Winner fanfare. */
  win(): void {
    this.stopHeartbeat();
    this.music.duck(0.15, 3.5);
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.2, { type: 'square', gain: 0.1, at: i * 0.11 }));
    for (const f of [523, 659, 784, 1047]) this.tone(f, 1.2, { type: 'triangle', gain: 0.09, at: 0.48, attack: 0.02 });
    this.noise(1.2, { type: 'highpass', freq: 5000, gain: 0.05, at: 0.48 });
  }

  /** Super Chat / new member: a bell. */
  chime(): void {
    for (const [f, g] of [[1320, 0.14], [1980, 0.07], [2640, 0.04]] as const) this.tone(f, 1.4, { gain: g });
    this.tone(1760, 1.2, { gain: 0.1, at: 0.15 });
  }

  /** The show is over: let the music fade out. */
  ending(): void {
    this.stopHeartbeat();
    this.music.fadeOut(4);
  }
}
