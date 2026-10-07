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
  /** Round number + big timer. */
  hud: Rect;
  /** "Type !join to play" banner. */
  joinBanner: Rect;
  leaderboard: Rect & { rows: number };
  /** Where the event feed and pop-ups (e.g. !stats) appear. */
  feed: Rect;
}

const LANDSCAPE: Layout = {
  name: 'landscape',
  width: 1920,
  height: 1080,
  arena: { x: 960, y: 560, radius: 440 },
  hud: { x: 40, y: 40, w: 380, h: 220 },
  joinBanner: { x: 560, y: 24, w: 800, h: 80 },
  leaderboard: { x: 1500, y: 40, w: 380, h: 640, rows: 10 },
  feed: { x: 40, y: 300, w: 380, h: 740 },
};

const VERTICAL: Layout = {
  name: 'vertical',
  width: 1080,
  height: 1920,
  arena: { x: 540, y: 960, radius: 500 },
  hud: { x: 40, y: 40, w: 1000, h: 170 },
  joinBanner: { x: 90, y: 240, w: 900, h: 100 },
  leaderboard: { x: 40, y: 1500, w: 1000, h: 380, rows: 5 },
  feed: { x: 40, y: 380, w: 1000, h: 60 },
};

export function pickLayout(search = window.location.search): Layout {
  const param = new URLSearchParams(search).get('layout')?.toLowerCase();
  return param === 'vertical' || param === 'portrait' || param === '9x16' ? VERTICAL : LANDSCAPE;
}
