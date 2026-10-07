// npm run youtube:check
// Tests your YouTube setup without starting the game: signs in, shows which
// channel you're signed in as, looks for a live stream, and (if you're live)
// listens to chat for 20 seconds so you can type in your own chat and see it.
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { convertItem } from './messages.ts';
import { ApiError, parseVideoId, YouTubeApi } from './api.ts';
import { GoogleAuth, SetupError } from './oauth.ts';
import { QuotaTracker } from './quota.ts';
import { openStream } from './stream.ts';

const { values: args } = parseArgs({ options: { video: { type: 'string' } } });
const config = loadConfig();
const auth = new GoogleAuth();
const quota = new QuotaTracker(config.youtube);
const api = new YouTubeApi(auth, quota, config.youtube);

try {
  await auth.ensure();
  console.log(`✔ Signed in. Channel: ${(await api.myChannelName()) ?? '(this Google account has no YouTube channel!)'}`);
  const video = args.video || config.youtube.videoId;
  const chat = video ? await api.chatForVideo(parseVideoId(video)) : await api.findActiveChat();
  if (!chat) {
    console.log('• Not live right now, so there is no chat to read. That is fine: sign-in works.');
    console.log('  To test chat, start a stream (it can be private or unlisted) and run this again.');
  } else {
    console.log(`✔ Live stream found: "${chat.title}"`);
    console.log('  Listening with streamList for 20 seconds. Type something in your live chat now...');
    quota.spend(config.youtube.costStreamOpen, 'stream');
    let count = 0;
    const handle = await openStream({
      accessToken: await auth.accessToken(),
      liveChatId: chat.liveChatId,
      onResponse: (r) => {
        quota.spend(config.youtube.costStreamResponse, 'stream');
        for (const item of r.items ?? []) {
          for (const e of convertItem(item).events) {
            count++;
            if (e.kind === 'text') console.log(`  ${e.viewer.name}: ${e.text}`);
            else if (e.kind === 'paid') console.log(`  [${e.event.kind}] from ${e.event.viewer.name}`);
          }
        }
      },
    });
    setTimeout(() => handle.cancel(), 20_000);
    const end = await handle.done;
    if (end.kind === 'error') {
      console.log(`✘ streamList failed: ${end.codeName} ${end.message}`);
      console.log('  The game will fall back to polling. Testing polling once...');
      const page = await api.listMessages(chat.liveChatId);
      console.log(`✔ Polling works (${page.items.length} recent messages, YouTube asks to poll every ${page.pollingIntervalMillis}ms).`);
    } else {
      console.log(`✔ streamList works (${count} messages received, including recent history).`);
    }
  }
  quota.logSummary();
  quota.save();
  process.exit(0);
} catch (err) {
  quota.save();
  if (err instanceof SetupError) console.error(`✘ ${err.message}`);
  else if (err instanceof ApiError) {
    console.error(`✘ YouTube API error ${err.status} (${err.reason}): ${err.message}`);
    if (err.reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(err.message)) {
      console.error('  Turn on "YouTube Data API v3" for your project (README section 3b).');
    }
    if (err.status === 403 && err.reason === 'insufficientPermissions') {
      console.error('  Delete secrets/token.json and run this again, ticking the YouTube permission when asked.');
    }
  } else console.error('✘', err);
  process.exit(1);
}
