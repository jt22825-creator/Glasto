import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** secrets/ holds your OAuth client and sign-in token. Override with NR_SECRETS_DIR (used by tests). */
export const secretsDir = (): string => process.env.NR_SECRETS_DIR ?? join(ROOT, 'secrets');
/** data/ holds the leaderboard and quota log. Override with NR_DATA_DIR (used by tests). */
export const dataDir = (): string => process.env.NR_DATA_DIR ?? join(ROOT, 'data');

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
