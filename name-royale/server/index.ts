// Entry point. Starts the WebSocket hub, a chat source, and (by default) the
// Vite dev server that serves the game page, all from one terminal.
//
//   node server/index.ts --source=sim       fake chat
//   node server/index.ts --source=youtube   real YouTube chat (stage 3)
//   add --no-game to skip starting the game page server
import { parseArgs } from 'node:util';
import { loadConfig, ROOT } from './config.ts';
import { Hub } from './hub.ts';
import { parseCommand } from './commands.ts';
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

let source: ChatSource | undefined;
if (args.source === 'sim') source = new SimulatorSource(config);
else if (args.source === 'youtube') source = new YouTubeSource();
else if (args.source !== 'none') {
  console.error(`Unknown --source "${args.source}". Use sim, youtube or none.`);
  process.exit(1);
}

hub.handleConnect((send) => send({ type: 'hello', config, source: source?.name ?? 'none' }));
hub.handleMessage((msg) => console.log('[game]', msg.type));

await source?.start((event) => {
  if (event.kind === 'paid') {
    console.log(`[chat] ${event.event.kind} from ${event.event.viewer.name}`);
    hub.broadcast({ type: 'paid', event: event.event });
    return;
  }
  const command = parseCommand(event.text);
  if (!command) return;
  hub.broadcast({ type: 'command', viewer: event.viewer, command });
});

if (!args['no-game']) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: ROOT, logLevel: 'warn' });
  await vite.listen();
  console.log('[game] Landscape: http://localhost:5173/');
  console.log('[game] Vertical:  http://localhost:5173/?layout=vertical');
}

const shutdown = () => {
  source?.stop();
  hub.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
