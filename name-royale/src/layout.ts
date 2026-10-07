// Screen layouts. Everything that depends on screen shape lives here, so the
// rest of the game code is the same for vertical and landscape.
//
// Vertical (1080x1920) is the default, for YouTube Shorts-style live streams.
// Use ?layout=landscape for a 1920x1080 stream.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  name: 'vertical' | 'landscape';
  width: number;
  height: number;
  arena: { x: number; y: number; radius: number };
  /** Round number, phase, players left and the big timer. */
  hud: Rect;
  /** "Type !join to play" banner. Always visible. */
  joinBanner: Rect;
  bannerFontSize: number;
  /**
   * The all-time leaderboard. 'list' is a tall panel (landscape). 'strip' is
   * a short row of 3 players that pages through the top 9 (vertical).
   */
  leaderboard: Rect & { style: 'list' | 'strip'; rows: number };
  /** Recent events (joins, eliminations). */
  feed: Rect & { lines: number };
  /** Pop-up cards for !stats and Super Chat thank-yous. */
  toast: Rect;
  /**
   * Areas YouTube's own buttons and text usually cover on a phone. Nothing
   * important is placed here. These are approximate; view them with ?safe.
   */
  covered: (Rect & { label: string })[];
}

const VERTICAL: Layout = {
  name: 'vertical',
  width: 1080,
  height: 1920,
  hud: { x: 40, y: 110, w: 1000, h: 180 },
  joinBanner: { x: 40, y: 305, w: 1000, h: 100 },
  bannerFontSize: 74,
  leaderboard: { x: 40, y: 420, w: 1000, h: 150, style: 'strip', rows: 9 },
  feed: { x: 40, y: 585, w: 1000, h: 60, lines: 1 },
  toast: { x: 40, y: 585, w: 1000, h: 60 },
  // Shifted left to keep clear of the like/comment/share buttons on the right.
  arena: { x: 505, y: 1070, radius: 420 },
  covered: [
    { x: 0, y: 0, w: 1080, h: 100, label: 'LIVE badge, close button' },
    { x: 950, y: 860, w: 130, h: 640, label: 'buttons' },
    { x: 0, y: 1510, w: 1080, h: 410, label: 'title, channel name and live chat' },
  ],
};

const LANDSCAPE: Layout = {
  name: 'landscape',
  width: 1920,
  height: 1080,
  arena: { x: 960, y: 590, radius: 440 },
  hud: { x: 40, y: 40, w: 400, h: 300 },
  joinBanner: { x: 520, y: 24, w: 880, h: 96 },
  bannerFontSize: 64,
  leaderboard: { x: 1480, y: 40, w: 400, h: 640, style: 'list', rows: 8 },
  feed: { x: 40, y: 370, w: 400, h: 670, lines: 14 },
  toast: { x: 1480, y: 710, w: 400, h: 330 },
  covered: [],
};

export function pickLayout(search = window.location.search): Layout {
  const param = new URLSearchParams(search).get('layout')?.toLowerCase();
  return param === 'landscape' || param === '16x9' ? LANDSCAPE : VERTICAL;
}
