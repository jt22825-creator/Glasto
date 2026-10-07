// Bots fill quiet rounds. Their names always start with "bot_" so nobody
// mistakes them for real viewers, and they never reach the leaderboard.
const WORDS = [
  'pebble', 'waffle', 'noodle', 'sprocket', 'biscuit', 'pickle', 'gizmo', 'muffin', 'button', 'widget',
  'crumpet', 'nugget', 'doodle', 'tofu', 'marble', 'puddle', 'pretzel', 'zigzag', 'bramble', 'teacup',
  'kazoo', 'turnip', 'dumpling', 'yo_yo', 'thimble', 'pogo', 'scone', 'jellybean', 'pixel', 'bobble',
];

/** `count` different bot names, e.g. "bot_pebble". */
export function pickBotNames(count: number): string[] {
  const pool = [...WORDS].sort(() => Math.random() - 0.5);
  return Array.from({ length: count }, (_, i) => `bot_${pool[i % pool.length]}${i >= pool.length ? i : ''}`);
}
