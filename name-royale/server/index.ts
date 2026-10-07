// Entry point. Starts the WebSocket hub, a chat source, and (by default) the
// Vite dev server that serves the game page, all from one terminal.
//
//   node server/index.ts --source=sim       fake chat
//   node server/index.ts --source=youtube   real YouTube chat (stage 3)
//   add --no-game to skip starting the game page server
import { parseArgs } from 'node:util';
import { loadConfig, ROOT } from './config.ts';
import { Hub } from './hub.ts';
import { CommandLimiter, parseCommand } from './commands.ts';
import { Leaderboard } from './leaderboard.ts';
import { cleanViewer, isBanned } from './moderation.ts';
import { SimulatorSource } from './sources/simulator.ts';
import { YouTubeSource } from './sources/youtube.ts';
import type { ChatSource } from './sources/types.ts';

const { values: args } = parseArgs({
  options: {
    source: { type: 'string', default: 'sim' },
    'no-game': { type: 'boolean', default: false },
  },
});

const config = loadConfig();
const hub = new Hub(config.server.wsPort);
const limiter = new CommandLimiter(config.commands);
const leaderboard = new Leaderboard();

let source: ChatSource | undefined;
if (args.source === 'sim') source = new SimulatorSource(config);
else if (args.source === 'youtube') source = new YouTubeSource();
else if (args.source !== 'none') {
  console.error(`Unknown --source "${args.source}". Use sim, youtube or none.`);
  process.exit(1);
}

hub.handleConnect((send, primary) => {
  send({ type: 'hello', config, source: source?.name ?? 'none', nextRound: leaderboard.nextRound, primary });
  send({ type: 'leaderboard', entries: leaderboard.top() });
});

hub.handleMessage((msg, fromPrimary) => {
  if (msg.type !== 'roundResult') return;
  if (!fromPrimary) return; // a preview tab's rounds don't count
  leaderboard.record(msg.round, msg.winner, msg.placements);
  const winnerStats = msg.winner ? leaderboard.stats(msg.winner.id) : null;
  console.log(
    `[round ${msg.round}] winner: ${msg.winner ? `${msg.winner.name} (${winnerStats?.wins} wins)` : 'a bot'}; ${msg.placements.length} humans played`,
  );
  hub.broadcast({ type: 'roundRecorded', round: msg.round, winner: msg.winner, winnerStats });
  hub.broadcast({ type: 'leaderboard', entries: leaderboard.top() });
});

await source?.start((event) => {
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
  if (command.kind === 'stats') {
    hub.broadcast({ type: 'stats', viewer, stats: leaderboard.stats(viewer.id) });
  } else {
    hub.broadcast({ type: 'command', viewer, command });
  }
});

if (!args['no-game']) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: ROOT, logLevel: 'warn' });
  await vite.listen();
  console.log('[game] Vertical:  http://localhost:5173/');
  console.log('[game] Landscape: http://localhost:5173/?layout=landscape');
  console.log('[game] Add &quick to either URL for short rounds while testing.');
}

const shutdown = () => {
  source?.stop();
  hub.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
