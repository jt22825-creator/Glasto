// Ban list and username cleanup. Everything shown on screen passes through here.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Viewer } from '../shared/protocol.ts';
import { WatchedList } from './textlist.ts';

const MAX_NAME_LENGTH = 20;
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', $: 's', '7': 't', '8': 'b', '9': 'g' };

const bans = new WatchedList(fileURLToPath(new URL('../config/banlist.txt', import.meta.url)), 'banlist');
const blocked = new WatchedList(fileURLToPath(new URL('../config/blocked-words.txt', import.meta.url)), 'blocked-words');

export function isBanned(viewer: Viewer): boolean {
  const name = viewer.name.toLowerCase();
  return bans.lines.some((entry) => entry === viewer.id || entry.toLowerCase() === name);
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/./g, (c) => LEET[c] ?? c)
    .normalize('NFKD')
    .replace(/[^a-z]/g, '');
}

/** Split "BigAss_123" into ["big", "ass"] so whole-word entries can match. */
function words(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9!|@$]+/)
    .map(normalise)
    .filter(Boolean);
}

export function isProfane(name: string): boolean {
  const flat = normalise(name);
  const tokens = words(name);
  return blocked.lines.some((raw) => {
    const entry = raw.toLowerCase();
    if (entry.startsWith('=')) return tokens.includes(normalise(entry.slice(1)));
    const w = normalise(entry);
    return w.length > 0 && flat.includes(w);
  });
}

/** Tidy a display name for the screen: trim, drop the @, cap the length, replace if profane. */
export function cleanViewer(viewer: Viewer): Viewer {
  let name = viewer.name
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, '')
    .trim()
    .replace(/^@/, '');
  if (!name || isProfane(name)) {
    name = `viewer_${createHash('sha1').update(viewer.id).digest('hex').slice(0, 4)}`;
  }
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH - 1) + '…';
  return { id: viewer.id, name };
}
