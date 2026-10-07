// Tests for the YouTube chat source, run against local fake YouTube servers
// (one gRPC for streamList, one HTTP for the REST API and token refresh).
// No Google account or internet needed:  npm test
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { mergeConfig } from '../shared/config.ts';
import type { ChatEvent } from '../server/sources/types.ts';

// ---------------------------------------------------------------- fake servers

const now = () => new Date().toISOString();
const old = () => new Date(Date.now() - 10 * 60_000).toISOString();

function text(id: string, channelId: string, name: string, msg: string, publishedAt = now()) {
  return { id, snippet: { type: 'TEXT_MESSAGE_EVENT', publishedAt, textMessageDetails: { messageText: msg } }, authorDetails: { channelId, displayName: name } };
}

/** What the fake gRPC server should do on each StreamList call, in order. */
type StreamScript = (call: grpc.ServerWritableStream<{ liveChatId: string; pageToken?: string }, unknown>) => void;
let streamScripts: StreamScript[] = [];
const streamRequests: { liveChatId: string; pageToken?: string; auth: string }[] = [];

/** Responses for REST liveChat/messages polls, in order. */
let pollPages: object[] = [];
const restCalls: string[] = [];
let activeChats: string[] = [];

let grpcServer: grpc.Server;
let http: Server;

async function startFakes(): Promise<void> {
  const def = protoLoader.loadSync(fileURLToPath(new URL('../server/youtube/live_chat.proto', import.meta.url)), {
    keepCase: false, longs: String, enums: String, defaults: false, oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(def) as any;
  grpcServer = new grpc.Server();
  grpcServer.addService(pkg.youtube.api.v3.V3DataLiveChatMessageService.service, {
    StreamList(call: any) {
      streamRequests.push({ liveChatId: call.request.liveChatId, pageToken: call.request.pageToken || undefined, auth: String(call.metadata.get('authorization')[0]) });
      const script = streamScripts.shift();
      if (script) script(call);
      else call.end();
    },
  });
  const grpcPort = await new Promise<number>((res, rej) =>
    grpcServer.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => (e ? rej(e) : res(p))),
  );

  http = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    restCalls.push(url.pathname);
    const json = (code: number, body: object) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (url.pathname === '/token') return json(200, { access_token: 'fresh-token', expires_in: 3600 });
    if (url.pathname === '/yt/channels') return json(200, { items: [{ snippet: { title: 'Test Channel' } }] });
    if (url.pathname === '/yt/liveBroadcasts') {
      const id = activeChats.shift();
      return json(200, { items: id ? [{ snippet: { title: `Stream ${id}`, liveChatId: id } }] : [] });
    }
    if (url.pathname === '/yt/liveChat/messages') {
      const page = pollPages.shift();
      return page ? json(200, page) : json(403, { error: { message: 'ended', errors: [{ reason: 'liveChatEnded' }] } });
    }
    json(404, {});
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const httpPort = (http.address() as AddressInfo).port;

  const secrets = mkdtempSync(join(tmpdir(), 'nr-secrets-'));
  writeFileSync(join(secrets, 'client_secret.json'), JSON.stringify({ installed: { client_id: 'cid', client_secret: 'csecret' } }));
  writeFileSync(join(secrets, 'token.json'), JSON.stringify({ refresh_token: 'r', access_token: 'test-token', expires_at: Date.now() + 3600_000 }));
  Object.assign(process.env, {
    NR_SECRETS_DIR: secrets,
    NR_DATA_DIR: mkdtempSync(join(tmpdir(), 'nr-data-')),
    NR_TOKEN_URL: `http://127.0.0.1:${httpPort}/token`,
    NR_YT_API_BASE: `http://127.0.0.1:${httpPort}/yt`,
    NR_YT_GRPC_TARGET: `127.0.0.1:${grpcPort}`,
    NR_YT_GRPC_INSECURE: '1',
  });
}

const testConfig = (youtube: object = {}) =>
  mergeConfig({ youtube: { minPollSeconds: 0.05, saverPollSeconds: 0.05, ...youtube } } as any);

/** Run the source until `until` returns true (or time out), collecting events. */
async function runSource(config: ReturnType<typeof testConfig>, until: (events: ChatEvent[]) => boolean, timeoutMs = 8000) {
  const { YouTubeSource } = await import('../server/sources/youtube.ts');
  const source = new YouTubeSource(config);
  const events: ChatEvent[] = [];
  await source.start((e) => events.push(e));
  const deadline = Date.now() + timeoutMs;
  while (!until(events) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  source.stop();
  return events;
}

const texts = (events: ChatEvent[]) => events.filter((e) => e.kind === 'text').map((e) => (e.kind === 'text' ? `${e.viewer.name}:${e.text}` : ''));

// ---------------------------------------------------------------- tests

describe('message conversion', async () => {
  const { convertItem } = await import('../server/youtube/messages.ts');

  it('reads REST and gRPC text messages the same way', () => {
    const rest = convertItem({ id: '1', snippet: { type: 'textMessageEvent', textMessageDetails: { messageText: '!join' } }, authorDetails: { channelId: 'UC1', displayName: 'Ann' } });
    const rpc = convertItem({ id: '1', snippet: { type: 'TEXT_MESSAGE_EVENT', textMessageDetails: { messageText: '!join' } }, authorDetails: { channelId: 'UC1', displayName: 'Ann' } });
    assert.deepEqual(rest, rpc);
    assert.deepEqual(rest.events, [{ kind: 'text', viewer: { id: 'UC1', name: 'Ann' }, text: '!join' }]);
  });

  it('turns Super Chats, Super Stickers and new members into paid events', () => {
    const sc = convertItem({ snippet: { type: 'superChatEvent', superChatDetails: { amountMicros: '5000000', currency: 'GBP', tier: 2, userComment: '!join please' } }, authorDetails: { channelId: 'UC2', displayName: 'Bo' } });
    assert.deepEqual(sc.events[0], { kind: 'paid', event: { kind: 'superChat', viewer: { id: 'UC2', name: 'Bo' }, amountMicros: 5_000_000, currency: 'GBP', tier: 2 } });
    assert.deepEqual(sc.events[1], { kind: 'text', viewer: { id: 'UC2', name: 'Bo' }, text: '!join please' });
    const st = convertItem({ snippet: { type: 'SUPER_STICKER_EVENT', superStickerDetails: { amountMicros: 2_000_000, currency: 'USD', tier: 1 } }, authorDetails: { channelId: 'UC3', displayName: 'Cy' } });
    assert.equal(st.events[0].kind, 'paid');
    const sp = convertItem({ snippet: { type: 'newSponsorEvent' }, authorDetails: { channelId: 'UC4', displayName: 'Di' } });
    assert.deepEqual(sp.events, [{ kind: 'paid', event: { kind: 'sponsor', viewer: { id: 'UC4', name: 'Di' } } }]);
  });

  it('spots the end of the chat and ignores everything else', () => {
    assert.equal(convertItem({ snippet: { type: 'CHAT_ENDED_EVENT' } }).chatEnded, true);
    assert.deepEqual(convertItem({ snippet: { type: 'messageDeletedEvent' }, authorDetails: { channelId: 'UC5', displayName: 'Ed' } }).events, []);
  });

  it('accepts video IDs and URLs', async () => {
    const { parseVideoId } = await import('../server/youtube/api.ts');
    for (const s of ['dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/live/dQw4w9WgXcQ?feature=share', 'https://youtube.com/shorts/dQw4w9WgXcQ']) {
      assert.equal(parseVideoId(s), 'dQw4w9WgXcQ');
    }
  });
});

describe('YouTube source against fake servers', () => {
  before(startFakes);
  after(() => {
    grpcServer.forceShutdown();
    http.close();
  });

  it('streams chat, skips old history, and reconnects with the page token', async () => {
    activeChats = ['chat-A'];
    streamScripts = [
      (call) => {
        call.write({ items: [text('old', 'UCo', 'Old', '!join', old()), text('m1', 'UC1', 'Ann', '!join')], nextPageToken: 'tok-1' });
        call.end(); // YouTube closing the stream; client must reconnect with tok-1
      },
      (call) => {
        call.write({ items: [text('m1', 'UC1', 'Ann', '!join'), text('m2', 'UC2', 'Bo', '!boost')], nextPageToken: 'tok-2' }); // m1 repeated: must be ignored
        setTimeout(() => call.write({ items: [{ id: 'end', snippet: { type: 'CHAT_ENDED_EVENT' } }] }), 50);
      },
    ];
    const events = await runSource(testConfig(), (e) => e.length >= 2);
    assert.deepEqual(texts(events), ['Ann:!join', 'Bo:!boost']);
    assert.equal(streamRequests[0].liveChatId, 'chat-A');
    assert.equal(streamRequests[0].auth, 'Bearer test-token');
    assert.equal(streamRequests[1].pageToken, 'tok-1');
  });

  it('falls back to polling when streamList is refused', async () => {
    activeChats = ['chat-B'];
    streamScripts = [(call) => call.emit('error', { code: grpc.status.UNIMPLEMENTED, details: 'no streaming for you' })];
    pollPages = [
      { items: [text('p1', 'UC7', 'Gus', '!join')], nextPageToken: 'p-tok', pollingIntervalMillis: 50 },
      { items: [text('p2', 'UC8', 'Hal', '!colour mint')], nextPageToken: 'p-tok2', pollingIntervalMillis: 50 },
    ];
    const events = await runSource(testConfig(), (e) => e.length >= 2);
    assert.deepEqual(texts(events), ['Gus:!join', 'Hal:!colour mint']);
    assert.ok(restCalls.includes('/yt/liveChat/messages'));
  });

  it('uses polling only when streamList is turned off in config', async () => {
    activeChats = ['chat-C'];
    const before = streamRequests.length;
    pollPages = [{ items: [text('q1', 'UC9', 'Ivy', '!join')], pollingIntervalMillis: 50 }];
    const events = await runSource(testConfig({ useStreamList: false }), (e) => e.length >= 1);
    assert.deepEqual(texts(events), ['Ivy:!join']);
    assert.equal(streamRequests.length, before);
  });
});

describe('quota tracker', () => {
  it('moves from normal to slow polling to stopped', async () => {
    const { QuotaTracker } = await import('../server/youtube/quota.ts');
    const q = new QuotaTracker(mergeConfig({ youtube: { dailyQuotaUnits: 100, quotaSaverFraction: 0.5, quotaStopFraction: 0.9 } } as any).youtube);
    const start = q.used;
    q.spend(100 * 0.5 - start - 1, 'list');
    assert.equal(q.level, 'normal');
    q.spend(1, 'list');
    assert.equal(q.level, 'saver');
    q.spend(40, 'list');
    assert.equal(q.level, 'stopped');
    q.save();
  });
});
