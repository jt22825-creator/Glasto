// Settings shared by the server and the game. The server reads
// config/game.config.json, fills in anything missing from DEFAULT_CONFIG,
// and sends the result to the game when it connects.

export interface GameConfig {
  round: {
    /** Seconds viewers have to type !join before the fight starts. */
    joinWindowSeconds: number;
    /** How long the podium screen stays up. */
    winnerScreenSeconds: number;
    /** Countdown shown after the podium, before the next join window opens. */
    countdownSeconds: number;
    /** Most balls allowed in one round. Later joiners wait for the next round. */
    maxPlayers: number;
  };
  arena: {
    /** Seconds of fighting before the edge starts to shrink. */
    shrinkDelaySeconds: number;
    /** Seconds for the edge to shrink from full size to nothing. The round always ends by then. */
    shrinkDurationSeconds: number;
  };
  bots: {
    /** Every round has at least this many balls. Bots fill the gap if not enough humans join. */
    minBalls: number;
  };
  chaos: {
    /** Random gap between chaos events (shockwave, swirl, quake) during a fight. */
    minGapSeconds: number;
    maxGapSeconds: number;
  };
  commands: {
    /** Minimum gap between any two commands from the same viewer. */
    perUserCooldownSeconds: number;
    /** Extra cooldown for !colour. */
    colourCooldownSeconds: number;
    /** Extra cooldown for !stats. */
    statsCooldownSeconds: number;
    /** How many times one viewer can !boost per round. */
    boostsPerRound: number;
  };
  server: {
    /** Port the game page connects to for chat commands. */
    wsPort: number;
  };
  youtube: {
    /** A specific stream's video ID or URL. Leave empty to find your current live stream automatically. */
    videoId: string;
    /** Use the low-latency streaming connection (streamList). If it fails, the server falls back to polling. */
    useStreamList: boolean;
    /** Never poll faster than this, even if YouTube allows it. */
    minPollSeconds: number;
    /** Daily quota for your Google Cloud project (default 10,000). */
    dailyQuotaUnits: number;
    /** Above this fraction of the daily quota, switch to slow polling. */
    quotaSaverFraction: number;
    /** Poll interval in slow-polling mode. */
    saverPollSeconds: number;
    /** Stop reading chat once this fraction of the daily quota is used. */
    quotaStopFraction: number;
    /** Estimated quota cost of one liveChatMessages.list call. */
    costListCall: number;
    /** Estimated quota cost of opening a streamList connection. */
    costStreamOpen: number;
    /** Estimated quota cost of each batch of messages streamList sends. */
    costStreamResponse: number;
    /** Estimated quota cost of looking up your channel, broadcast or video. */
    costLookup: number;
  };
  simulator: {
    /** Number of fake viewers. */
    viewers: number;
    /** Average fake chat messages per second. */
    messagesPerSecond: number;
  };
}

export const DEFAULT_CONFIG: GameConfig = {
  round: {
    joinWindowSeconds: 45,
    winnerScreenSeconds: 10,
    countdownSeconds: 5,
    maxPlayers: 60,
  },
  arena: {
    shrinkDelaySeconds: 10,
    shrinkDurationSeconds: 150,
  },
  bots: {
    minBalls: 12,
  },
  chaos: {
    minGapSeconds: 12,
    maxGapSeconds: 20,
  },
  commands: {
    perUserCooldownSeconds: 2,
    colourCooldownSeconds: 20,
    statsCooldownSeconds: 30,
    boostsPerRound: 1,
  },
  server: {
    wsPort: 8787,
  },
  youtube: {
    videoId: '',
    useStreamList: true,
    minPollSeconds: 2,
    dailyQuotaUnits: 10000,
    quotaSaverFraction: 0.75,
    saverPollSeconds: 12,
    quotaStopFraction: 0.95,
    costListCall: 5,
    costStreamOpen: 1,
    costStreamResponse: 1,
    costLookup: 1,
  },
  simulator: {
    viewers: 25,
    messagesPerSecond: 1.5,
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Overlay a (possibly incomplete) user config on the defaults, ignoring unknown keys and wrong types. */
export function mergeConfig(user: DeepPartial<GameConfig> | undefined): GameConfig {
  const out = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, Record<string, unknown>>;
  const src = (user ?? {}) as Record<string, Record<string, unknown> | undefined>;
  for (const section of Object.keys(out)) {
    const given = src[section];
    if (!given || typeof given !== 'object') continue;
    for (const key of Object.keys(out[section])) {
      if (typeof given[key] === typeof out[section][key]) out[section][key] = given[key];
    }
  }
  return out as unknown as GameConfig;
}
