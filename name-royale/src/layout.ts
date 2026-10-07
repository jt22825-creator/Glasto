// Screen layouts. Everything that depends on screen shape lives here, so the
// rest of the game code is the same for landscape and vertical.
//
// Pick one with the URL: ?layout=landscape (default, 1920x1080) or ?layout=vertical (1080x1920).

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  name: 'landscape' | 'vertical';
  width: number;
  height: number;
  arena: { x: number; y: number; radius: number };
  /** Round number, phase, players left and the big timer. */
  hud: Rect;
  /** "Type !join to play" banner. Always visible. */
  joinBanner: Rect;
  leaderboard: Rect & { rows: number };
  /** Recent events (joins, eliminations). */
  feed: Rect & { lines: number };
  /** Pop-up cards for !stats and Super Chat thank-yous. */
  toast: Rect;
  /** Size of the "Type !join to play" text. */
  bannerFontSize: number;
}

const LANDSCAPE: Layout = {
  name: 'landscape',
  width: 1920,
  height: 1080,
  arena: { x: 960, y: 590, radius: 440 },
  hud: { x: 40, y: 40, w: 400, h: 300 },
  joinBanner: { x: 520, y: 24, w: 880, h: 96 },
  leaderboard: { x: 1480, y: 40, w: 400, h: 640, rows: 8 },
  feed: { x: 40, y: 370, w: 400, h: 670, lines: 14 },
  toast: { x: 1480, y: 710, w: 400, h: 330 },
  bannerFontSize: 64,
};

const VERTICAL: Layout = {
  name: 'vertical',
  width: 1080,
  height: 1920,
  arena: { x: 540, y: 950, radius: 480 },
  hud: { x: 40, y: 40, w: 1000, h: 190 },
  joinBanner: { x: 60, y: 250, w: 960, h: 110 },
  leaderboard: { x: 40, y: 1540, w: 1000, h: 340, rows: 5 },
  feed: { x: 40, y: 380, w: 1000, h: 56, lines: 1 },
  toast: { x: 90, y: 1440, w: 900, h: 86 },
  bannerFontSize: 76,
};

export function pickLayout(search = window.location.search): Layout {
  const param = new URLSearchParams(search).get('layout')?.toLowerCase();
  return param === 'vertical' || param === 'portrait' || param === '9x16' ? VERTICAL : LANDSCAPE;
}
