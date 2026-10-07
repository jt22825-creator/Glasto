import { existsSync, readFileSync, watchFile } from 'node:fs';

/**
 * Reads a text file as a list of lines (ignoring blanks and # comments) and
 * re-reads it when it changes, so you can edit it while the stream is live.
 */
export class WatchedList {
  lines: string[] = [];
  private path: string;
  private label: string;

  constructor(path: string, label: string) {
    this.path = path;
    this.label = label;
    this.load();
    watchFile(path, { interval: 2000 }, () => {
      this.load();
      console.log(`[${label}] Reloaded (${this.lines.length} entries)`);
    });
  }

  private load(): void {
    if (!existsSync(this.path)) {
      this.lines = [];
      return;
    }
    try {
      this.lines = readFileSync(this.path, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
    } catch (err) {
      console.error(`[${this.label}] Could not read ${this.path}: ${(err as Error).message}`);
    }
  }
}
