// Keeps a running estimate of today's YouTube API quota use, so the server
// can slow down and then stop before Google cuts it off.
//
// Google doesn't let a program read its live quota usage, so this is an
// estimate built from per-call costs in config. The real number is on the
// Google Cloud Console Quotas page; compare the two after your first stream
// and adjust the youtube.cost* settings if they differ.
//
// Quota resets at midnight Pacific time, so "today" is the Pacific date.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameConfig } from '../../shared/config.ts';
import { dataDir, ensureDir } from '../paths.ts';

export type QuotaLevel = 'normal' | 'saver' | 'stopped';

interface QuotaFile {
  date: string;
  used: number;
  byCall: Record<string, number>;
}

const pacificDate = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export class QuotaTracker {
  private file: string;
  private state: QuotaFile;
  private config: GameConfig['youtube'];
  private lastLoggedTenth = -1;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(config: GameConfig['youtube']) {
    this.config = config;
    this.file = join(ensureDir(dataDir()), 'quota.json');
    this.state = this.load();
    this.lastLoggedTenth = Math.floor(this.fraction * 10);
    // Print a summary every 10 minutes while running.
    setInterval(() => this.logSummary(), 10 * 60_000).unref();
  }

  private load(): QuotaFile {
    const fresh = { date: pacificDate(), used: 0, byCall: {} };
    if (!existsSync(this.file)) return fresh;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as QuotaFile;
      return saved.date === pacificDate() ? saved : fresh;
    } catch {
      return fresh;
    }
  }

  private rollover(): void {
    if (this.state.date !== pacificDate()) {
      console.log('[quota] New day (Pacific time): quota estimate reset to 0.');
      this.state = { date: pacificDate(), used: 0, byCall: {} };
      this.lastLoggedTenth = 0;
      this.save();
    }
  }

  spend(units: number, call: string): void {
    if (units <= 0) return;
    this.rollover();
    this.state.used += units;
    this.state.byCall[call] = (this.state.byCall[call] ?? 0) + units;
    const tenth = Math.floor(this.fraction * 10);
    if (tenth > this.lastLoggedTenth) {
      this.lastLoggedTenth = tenth;
      this.logSummary();
      if (this.level === 'saver') console.warn(`[quota] Over ${Math.round(this.config.quotaSaverFraction * 100)}%: switching to slow polling to save quota.`);
      if (this.level === 'stopped') console.warn(`[quota] Over ${Math.round(this.config.quotaStopFraction * 100)}%: chat reading paused until quota resets at midnight Pacific time.`);
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 2000);
  }

  get used(): number {
    this.rollover();
    return this.state.used;
  }

  get fraction(): number {
    return this.state.used / Math.max(1, this.config.dailyQuotaUnits);
  }

  get level(): QuotaLevel {
    this.rollover();
    const f = this.fraction;
    if (f >= this.config.quotaStopFraction) return 'stopped';
    if (f >= this.config.quotaSaverFraction) return 'saver';
    return 'normal';
  }

  /** Call this if YouTube says the quota really is used up, so our estimate matches. */
  markExhausted(): void {
    this.rollover();
    this.state.used = Math.max(this.state.used, this.config.dailyQuotaUnits);
    this.save();
  }

  logSummary(): void {
    const parts = Object.entries(this.state.byCall)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    console.log(
      `[quota] ~${this.state.used} / ${this.config.dailyQuotaUnits} units used today (${Math.round(this.fraction * 100)}%, estimate)${parts ? `: ${parts}` : ''}`,
    );
  }

  save(): void {
    clearTimeout(this.saveTimer);
    try {
      writeFileSync(this.file, JSON.stringify(this.state, null, 2));
    } catch (err) {
      console.error(`[quota] Could not save ${this.file}: ${(err as Error).message}`);
    }
  }
}
