import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mergeConfig, type GameConfig } from '../shared/config.ts';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CONFIG_PATH = fileURLToPath(new URL('../config/game.config.json', import.meta.url));

export function loadConfig(): GameConfig {
  try {
    return mergeConfig(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')));
  } catch (err) {
    console.error(`[config] Could not read ${CONFIG_PATH}: ${(err as Error).message}`);
    console.error('[config] Using built-in defaults. Check the file is valid JSON (no trailing commas).');
    return mergeConfig(undefined);
  }
}
