// Fake chat for testing without going live. Generates random viewers and
// commands, and lets you type your own lines into the terminal:
//   alice !join            -> "alice" sends !join
//   alice !colour mint     -> "alice" picks a colour
//   superchat alice 5      -> "alice" sends a $5 Super Chat
//   sponsor alice          -> "alice" becomes a member
//   pause / resume         -> stop or start the random viewers
import { createInterface } from 'node:readline';
import type { GameConfig } from '../../shared/config.ts';
import type { Viewer } from '../../shared/protocol.ts';
import type { ChatEvent, ChatSource } from './types.ts';

const FIRST = ['Pixel', 'Turbo', 'Mossy', 'Neon', 'Quiet', 'Lucky', 'Fuzzy', 'Cosmic', 'Salty', 'Velvet', 'Rusty', 'Sunny'];
const SECOND = ['Moth', 'Otter', 'Kettle', 'Comet', 'Waffle', 'Badger', 'Pickle', 'Lantern', 'Gecko', 'Noodle', 'Pebble', 'Falcon'];
const CHATTER = ['lol', 'gg', 'go go go', 'who is winning', 'first time here', 'that was close', 'RIP', 'hi chat'];
const COLOURS = ['red', 'orange', 'yellow', 'lime', 'mint', 'sky', 'blue', 'purple', 'pink', 'white'];

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

function makeViewer(i: number): Viewer {
  const suffix = Math.random() < 0.5 ? String(Math.floor(Math.random() * 100)) : '';
  return { id: `sim-${i}`, name: `${pick(FIRST)}${pick(SECOND)}${suffix}` };
}

function randomText(): string {
  const r = Math.random();
  if (r < 0.55) return '!join';
  if (r < 0.75) return '!boost';
  if (r < 0.82) return `!colour ${pick(COLOURS)}`;
  if (r < 0.87) return '!stats';
  return pick(CHATTER);
}

export class SimulatorSource implements ChatSource {
  readonly name = 'simulator';
  private timer: NodeJS.Timeout | undefined;
  private paused = false;
  private viewers: Viewer[];
  private typed = new Map<string, Viewer>();
  private rl: ReturnType<typeof createInterface> | undefined;
  private config: GameConfig['simulator'];

  constructor(config: GameConfig) {
    this.config = config.simulator;
    this.viewers = Array.from({ length: this.config.viewers }, (_, i) => makeViewer(i));
  }

  async start(emit: (event: ChatEvent) => void): Promise<void> {
    const tick = () => {
      if (!this.paused) emit({ kind: 'text', viewer: pick(this.viewers), text: randomText() });
      // Random gaps around the configured average rate, so traffic feels bursty.
      const meanMs = 1000 / Math.max(0.05, this.config.messagesPerSecond);
      this.timer = setTimeout(tick, -Math.log(1 - Math.random()) * meanMs);
    };
    tick();

    this.rl = createInterface({ input: process.stdin });
    this.rl.on('line', (line) => this.handleTyped(line.trim(), emit));
    console.log('[sim] Type "<name> <message>", "superchat <name> <dollars>", "sponsor <name>", "pause" or "resume".');
  }

  private viewerNamed(name: string): Viewer {
    let v = this.typed.get(name);
    if (!v) {
      v = { id: `sim-typed-${name}`, name };
      this.typed.set(name, v);
    }
    return v;
  }

  private handleTyped(line: string, emit: (event: ChatEvent) => void): void {
    if (!line) return;
    const [first, second, third] = line.split(/\s+/);
    if (first === 'pause' || first === 'resume') {
      this.paused = first === 'pause';
      console.log(`[sim] random viewers ${this.paused ? 'paused' : 'resumed'}`);
    } else if (first === 'superchat' && second) {
      const dollars = Number(third ?? 5) || 5;
      emit({
        kind: 'paid',
        event: { kind: 'superChat', viewer: this.viewerNamed(second), amountMicros: dollars * 1_000_000, currency: 'USD', tier: dollars >= 20 ? 3 : dollars >= 5 ? 2 : 1 },
      });
    } else if (first === 'sponsor' && second) {
      emit({ kind: 'paid', event: { kind: 'sponsor', viewer: this.viewerNamed(second) } });
    } else if (second) {
      emit({ kind: 'text', viewer: this.viewerNamed(first), text: line.slice(first.length).trim() });
    } else {
      console.log('[sim] Not understood. Example: alice !join');
    }
  }

  stop(): void {
    clearTimeout(this.timer);
    this.rl?.close();
  }
}
