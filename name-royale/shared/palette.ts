// The fixed colour palette for !colour. Bold, flat colours that stand out on the dark arena.

export const PALETTE = {
  red: 0xff3b3b,
  orange: 0xff8a1f,
  yellow: 0xffd23f,
  lime: 0x9be22d,
  mint: 0x3df2b0,
  sky: 0x4cc9ff,
  blue: 0x3b6bff,
  purple: 0xa35cff,
  pink: 0xff4f8b,
  white: 0xf4f1ff,
} as const;

export type ColourName = keyof typeof PALETTE;

export const COLOUR_NAMES = Object.keys(PALETTE) as ColourName[];

/** Common words viewers might type that map onto a palette colour. */
const ALIASES: Record<string, ColourName> = {
  green: 'lime',
  teal: 'mint',
  aqua: 'mint',
  cyan: 'sky',
  lightblue: 'sky',
  navy: 'blue',
  violet: 'purple',
  magenta: 'pink',
  gold: 'yellow',
  amber: 'orange',
};

export function resolveColour(input: string): ColourName | null {
  const key = input.toLowerCase().replace(/[^a-z]/g, '');
  if (key in PALETTE) return key as ColourName;
  return ALIASES[key] ?? null;
}

/** A stable default colour for a viewer who hasn't picked one. */
export function defaultColourFor(id: string): ColourName {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLOUR_NAMES[h % COLOUR_NAMES.length];
}
