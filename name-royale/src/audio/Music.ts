// A small looping background track, made the same way as the sound effects:
// a four-chord progression with a bass line, a soft arpeggio and light drums.
// Notes are scheduled slightly ahead on the audio clock so timing stays tight.

const BPM = 112;
const STEP = 60 / BPM / 4; // one 16th note, in seconds
/** Am – F – C – G, one bar each. Root note and chord tones as MIDI numbers. */
const BARS: { root: number; chord: number[] }[] = [
  { root: 45, chord: [69, 72, 76] },
  { root: 41, chord: [69, 72, 77] },
  { root: 48, chord: [67, 72, 76] },
  { root: 43, chord: [67, 71, 74] },
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2]; // chord-tone order for each pair of 16ths

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class Music {
  private ctx: BaseAudioContext;
  private out: GainNode;
  private volume: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private nextStepTime = 0;
  private step = 0;
  private noise: AudioBuffer;

  constructor(ctx: BaseAudioContext, destination: AudioNode, volume: number) {
    this.ctx = ctx;
    this.volume = volume;
    this.out = ctx.createGain();
    this.out.gain.value = volume;
    this.out.connect(destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate / 4, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Start looping (live playback). */
  start(): void {
    if (this.timer) return;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => {
      // Schedule everything due in the next 200 ms.
      while (this.nextStepTime < this.ctx.currentTime + 0.2) {
        this.playStep(this.step, this.nextStepTime);
        this.step = (this.step + 1) % (BARS.length * 16);
        this.nextStepTime += STEP;
      }
    }, 50);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Schedule whole bars up front (used to render a preview offline). */
  scheduleBars(from: number, bars: number): void {
    for (let i = 0; i < bars * 16; i++) this.playStep(i % (BARS.length * 16), from + i * STEP);
  }

  /** Turn the music down to `level` (0..1 of normal), and back up after `seconds` (or until restore()). */
  duck(level: number, seconds?: number): void {
    const g = this.out.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.volume * level, t + 0.4);
    if (seconds) g.linearRampToValueAtTime(this.volume, t + seconds + 1.5);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.out.gain.value = volume;
  }

  restore(): void {
    this.duck(1);
  }

  fadeOut(seconds: number): void {
    const g = this.out.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + seconds);
    setTimeout(() => this.stop(), seconds * 1000 + 100);
  }

  private playStep(step: number, t: number): void {
    const bar = BARS[Math.floor(step / 16) % BARS.length];
    const s = step % 16;
    if (s % 2 === 0) this.note(hz(bar.root), t, STEP * 1.8, 'triangle', s % 8 === 0 ? 0.32 : 0.22, 900);
    this.note(hz(bar.chord[ARP[Math.floor(s / 2) % ARP.length]] + (s % 2 ? 12 : 0)), t, STEP * 0.9, 'square', 0.035, 2600);
    if (s % 8 === 0) this.kick(t);
    if (s % 4 === 2) this.hat(t);
  }

  private note(freq: number, t: number, dur: number, type: OscillatorType, gain: number, cutoff: number): void {
    const osc = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f).connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private kick(t: number): void {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private hat(t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.out);
    src.start(t);
    src.stop(t + 0.06);
  }
}
