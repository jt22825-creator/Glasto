// Entry point. Starts the WebSocket hub, a chat source, and (by default) the
// Vite dev server that serves the game page, all from one terminal.
//
//   node server/index.ts --source=sim       fake chat
//   node server/index.ts --source=youtube   real YouTube chat
//   add --video=<id or URL> to read a specific stream's chat
//   add --no-game to skip starting the game page server
//
// While it runs, type "end" and press Enter to finish the show: the current
// round completes, the end card shows, and OBS stops streaming.
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { loadConfig, ROOT } from './config.ts';
import { ShowEnder } from './ending.ts';
import { Hub } from './hub.ts';
import { CommandLimiter, parseCommand } from './commands.ts';
import { Leaderboard } from './leaderboard.ts';
import { cleanViewer, isBanned, isProfane } from './moderation.ts';
import { obsStatus } from './obs.ts';
import { SimulatorSource } from './sources/simulator.ts';
import { YouTubeSource } from './sources/youtube.ts';
import type { ChatEvent, ChatSource } from './sources/types.ts';
import { SetupError } from './youtube/oauth.ts';

const { values: args } = parseArgs({
  options: {
    source: { type: 'string', default: 'sim' },
    'no-game': { type: 'boolean', default: false },
    video: { type: 'string' },
  },
});

const config = loadConfig();
const hub = new Hub(config.server.wsPort);
const limiter = new CommandLimiter(config.commands);
const leaderboard = new Leaderboard();
const ender = new ShowEnder(config.ending, hub);

let source: ChatSource | undefined;
if (args.source === 'sim') source = new SimulatorSource(config);
else if (args.source === 'youtube') source = new YouTubeSource(config, { video: args.video });
else if (args.source !== 'none') {
  console.error(`Unknown --source "${args.source}". Use sim, youtube or none.`);
  process.exit(1);
}

/** Leaderboard for the screen: banned viewers hidden, names re-checked against the current word list. */
const board = () =>
  leaderboard
    .top(undefined, (e) => isBanned(e))
    .map((e) => (isProfane(e.name) ? { ...e, name: cleanViewer(e).name } : e));

hub.handleConnect((send, primary) => {
  send({ type: 'hello', config, source: source?.name ?? 'none', nextRound: leaderboard.nextRound, primary, ending: ender.ending });
  send({ type: 'leaderboard', entries: board() });
});

hub.handleMessage((msg, fromPrimary) => {
  if (!fromPrimary) return; // a preview tab's rounds don't count
  if (msg.type === 'ended') {
    ender.onGameEnded();
    return;
  }
  leaderboard.record(msg.round, msg.winner, msg.placements);
  const winnerStats = msg.winner ? leaderboard.stats(msg.winner.id) : null;
  console.log(
    `[round ${msg.round}] winner: ${msg.winner ? `${msg.winner.name} (${winnerStats?.wins} wins)` : 'a bot'}; ${msg.placements.length} humans played`,
  );
  hub.broadcast({ type: 'roundRecorded', round: msg.round, winner: msg.winner, winnerStats });
  hub.broadcast({ type: 'leaderboard', entries: board() });
});

const onChat = (event: ChatEvent) => {
  if (event.kind === 'exhausted') {
    if (config.ending.endShowWhenQuotaRunsOut) void ender.begin(event.reason);
    else console.warn(`[chat] ${event.reason}. The game keeps running with bots (ending.endShowWhenQuotaRunsOut is off).`);
    return;
  }
  if (ender.ending) return; // no new players once the show is ending
  if (event.kind === 'paid') {
    const viewer = cleanViewer(event.event.viewer);
    if (isBanned(viewer)) return;
    console.log(`[chat] ${event.event.kind} from ${viewer.name}`);
    hub.broadcast({ type: 'paid', event: { ...event.event, viewer } });
    return;
  }
  const command = parseCommand(event.text);
  if (!command) return;
  if (isBanned(event.viewer)) return;
  if (!limiter.allow(event.viewer.id, command.kind)) return;
  const viewer = cleanViewer(event.viewer);
  switch (command.kind) {
    case 'stats':
      hub.broadcast({ type: 'stats', viewer, stats: leaderboard.stats(viewer.id) });
      return;
    case 'colour':
      leaderboard.setColour(viewer, command.colour); // remembered for future rounds and streams
      hub.broadcast({ type: 'command', viewer, command });
      return;
    case 'join':
      hub.broadcast({ type: 'command', viewer, command: { kind: 'join', colour: leaderboard.colour(viewer.id) } });
      return;
    default:
      hub.broadcast({ type: 'command', viewer, command });
  }
};

try {
  await source?.start(onChat);
} catch (err) {
  if (err instanceof SetupError) {
    console.error(`\n[setup] ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

// Live shows: check early that OBS can be reached, so a problem shows up now rather than at the end.
if (args.source === 'youtube' && config.ending.stopObsStream) {
  obsStatus(config.ending.obsWebSocketUrl)
    .then((s) => console.log(`[obs] Connected to OBS (${s.streaming ? 'streaming' : 'not streaming yet'}). It will be stopped automatically when the show ends.`))
    .catch((err) => console.warn(`[obs] ${err.message}. The stream won't stop automatically; see README "Ending the show".`));
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim().toLowerCase() === 'end') void ender.begin('you typed "end"');
});

if (!args['no-game']) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: ROOT, logLevel: 'warn' });
  await vite.listen();
  console.log('[game] Vertical:  http://localhost:5173/');
  console.log('[game] Landscape: http://localhost:5173/?layout=landscape');
  console.log('[game] Add ?quick for short rounds while testing. Type "end" here to finish the show.');
}

const shutdown = () => {
  source?.stop();
  leaderboard.save();
  hub.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
