// Bold, flat, high-contrast colours. Used everywhere so the look stays consistent.
export const THEME = {
  bg: 0x16132d,
  floor: 0x2a2550,
  floorLine: 0x342e63,
  edge: 0xffd23f,
  danger: 0xff3b3b,
  accent: 0xff4f8b,
  good: 0x3df2b0,
  panel: 0x0d0b1f,
  outline: 0x0d0b1f,
  gold: 0xffd23f,
  silver: 0xc9d3e6,
  bronze: 0xe08a4a,
  text: '#ffffff',
  textDim: '#b9b3e6',
  textAccent: '#ffd23f',
  textDanger: '#ff5a5a',
  textGood: '#3df2b0',
  stroke: '#0d0b1f',
  /** Thick system fonts that exist on both Windows and Mac. */
  font: '"Arial Black", "Segoe UI Black", Impact, system-ui, sans-serif',
} as const;

export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
