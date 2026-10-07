// Real YouTube live chat.
//
//  1. Sign in (browser, first time only) with read-only access.
//  2. Find your live stream's chat: the broadcast that's live right now, or
//     the video in youtube.videoId / --video. If you're not live yet, it checks
//     again every minute.
//  3. Read chat with streamList (pushed over gRPC, low latency, low quota). If
//     that isn't available, or keeps failing, it falls back to polling
//     liveChatMessages.list at the interval YouTube asks for.
//  4. Watch the quota estimate: above quotaSaverFraction it polls slowly, above
//     quotaStopFraction it stops until the quota resets at midnight Pacific.
import type { GameConfig } from '../../shared/config.ts';
import { ApiError, parseVideoId, YouTubeApi, type ChatTarget } from '../youtube/api.ts';
import { convertItem, SeenIds, type RawChatItem } from '../youtube/messages.ts';
import { GoogleAuth } from '../youtube/oauth.ts';
import { QuotaTracker } from '../youtube/quota.ts';
import { GrpcCode, openStream, type StreamHandle } from '../youtube/stream.ts';
import type { ChatEvent, ChatSource } from './types.ts';

const NOT_LIVE_RETRY_MS = 60_000;
const QUOTA_STOPPED_RETRY_MS = 60_000;
/** Ignore messages sent before the server started (YouTube sends recent history first). */
const BACKLOG_GRACE_MS = 10_000;
/** This many stream failures within STREAM_FAILURE_WINDOW_MS switches to polling for the session. */
const STREAM_MAX_FAILURES = 3;
const STREAM_FAILURE_WINDOW_MS = 2 * 60_000;

type StreamResult = { next: 'reconnect'; delayMs: number } | { next: 'poll' } | { next: 'chatEnded' };

export class YouTubeSource implements ChatSource {
  readonly name = 'youtube';
  private config: GameConfig['youtube'];
  private videoOverride: string | undefined;
  private auth = new GoogleAuth();
  private quota: QuotaTracker;
  private api: YouTubeApi;
  private emit: (e: ChatEvent) => void = () => {};
  private seen = new SeenIds();
  private startedAt = Date.now();
  private stopped = false;
  private stream: StreamHandle | undefined;
  private wake: (() => void) | undefined;
  private streamDisabled = false;
  private streamFailures: number[] = [];
  private pageToken: string | undefined;
  private mode: 'stream' | 'poll' | undefined;

  constructor(config: GameConfig, opts: { video?: string } = {}) {
    this.config = config.youtube;
    this.videoOverride = opts.video || config.youtube.videoId || undefined;
    this.quota = new QuotaTracker(config.youtube);
    this.api = new YouTubeApi(this.auth, this.quota, config.youtube);
  }

  async start(emit: (event: ChatEvent) => void): Promise<void> {
    this.emit = emit;
    await this.auth.ensure(); // may open the browser to sign in
    const channel = await this.api.myChannelName();
    console.log(`[youtube] Signed in as channel: ${channel ?? '(no channel found on this Google account!)'}`);
    this.quota.logSummary();
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    this.stream?.cancel();
    this.wake?.();
    this.quota.save();
  }

  // ------------------------------------------------------------ main loop

  private async run(): Promise<void> {
    let backoffMs = 5000;
    let warnedStopped = false;
    while (!this.stopped) {
      try {
        if (this.quota.level === 'stopped') {
          if (!warnedStopped) console.warn('[youtube] Quota nearly used up: not reading chat until it resets (midnight Pacific time).');
          warnedStopped = true;
          await this.sleep(QUOTA_STOPPED_RETRY_MS);
          continue;
        }
        warnedStopped = false;
        const chat = await this.findChat();
        if (!chat) {
          console.log(
            this.videoOverride
              ? `[youtube] Video ${this.videoOverride} has no active live chat. Checking again in 60s.`
              : '[youtube] No live stream found on your channel. Start streaming (YouTube Studio → Go live). Checking again in 60s.',
          );
          await this.sleep(NOT_LIVE_RETRY_MS);
          continue;
        }
        console.log(`[youtube] Reading chat for "${chat.title}"`);
        backoffMs = 5000;
        this.pageToken = undefined;
        this.mode = undefined;
        await this.readChat(chat);
        if (!this.stopped) console.log('[youtube] The live chat has ended. Looking for a new stream...');
      } catch (err) {
        if (this.stopped) return;
        if (err instanceof ApiError && err.reason === 'quotaExceeded') {
          console.error('[youtube] YouTube says the daily quota is used up. Pausing until it resets.');
          this.quota.markExhausted();
          continue;
        }
        console.error(`[youtube] ${describe(err)}. Retrying in ${Math.round(backoffMs / 1000)}s.`);
        await this.sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 120_000);
      }
    }
  }

  private async findChat(): Promise<ChatTarget | null> {
    return this.videoOverride ? this.api.chatForVideo(parseVideoId(this.videoOverride)) : this.api.findActiveChat();
  }

  /** Read one chat until it ends. Switches between streaming and polling as needed. */
  private async readChat(chat: ChatTarget): Promise<void> {
    while (!this.stopped) {
      const level = this.quota.level;
      if (level === 'stopped') return;
      if (this.config.useStreamList && !this.streamDisabled && level === 'normal') {
        this.setMode('stream');
        const r = await this.streamOnce(chat);
        if (r.next === 'chatEnded') return;
        if (r.next === 'reconnect') await this.sleep(r.delayMs);
        continue;
      }
      this.setMode('poll');
      const { chatEnded, waitMs } = await this.pollOnce(chat, level === 'saver');
      if (chatEnded) return;
      await this.sleep(waitMs);
    }
  }

  private setMode(mode: 'stream' | 'poll'): void {
    if (mode === this.mode) return;
    this.mode = mode;
    console.log(mode === 'stream' ? '[youtube] Using streamList (live push).' : '[youtube] Using liveChatMessages.list (polling).');
  }

  // ------------------------------------------------------------ streaming

  private async streamOnce(chat: ChatTarget): Promise<StreamResult> {
    let chatEnded = false;
    let responses = 0;
    const openedAt = Date.now();
    let handle: StreamHandle;
    try {
      const accessToken = await this.auth.accessToken();
      this.quota.spend(this.config.costStreamOpen, 'stream');
      handle = await openStream({
        accessToken,
        liveChatId: chat.liveChatId,
        pageToken: this.pageToken,
        onResponse: (r) => {
          responses++;
          this.quota.spend(this.config.costStreamResponse, 'stream');
          if (r.nextPageToken) this.pageToken = r.nextPageToken;
          if (this.handleItems(r.items) || r.offlineAt) chatEnded = true;
          if (chatEnded || this.quota.level !== 'normal') handle.cancel();
        },
      });
    } catch (err) {
      console.warn(`[youtube] Streaming isn't available (${describe(err)}). Falling back to polling.`);
      this.streamDisabled = true;
      return { next: 'poll' };
    }
    this.stream = handle;
    const end = await handle.done;
    this.stream = undefined;

    if (chatEnded) return { next: 'chatEnded' };
    if (end.kind === 'cancelled') return { next: 'reconnect', delayMs: 0 };
    if (end.kind === 'ended') {
      // Normal: YouTube closes streams now and then. Reconnect straight away,
      // unless it closed instantly with nothing, which counts as a failure.
      if (responses > 0 || Date.now() - openedAt > 5000) return { next: 'reconnect', delayMs: 0 };
      return this.streamFailed('stream closed immediately');
    }

    switch (end.code) {
      case GrpcCode.UNAUTHENTICATED:
        this.auth.invalidate();
        return this.streamFailed('sign-in rejected, refreshing');
      case GrpcCode.RESOURCE_EXHAUSTED:
        if (/quota/i.test(end.message)) {
          console.error('[youtube] YouTube says the daily quota is used up. Pausing until it resets.');
          this.quota.markExhausted();
          return { next: 'poll' }; // readChat sees level 'stopped' and returns
        }
        return this.streamFailed(`rate limited: ${end.message}`, 10_000);
      case GrpcCode.NOT_FOUND:
      case GrpcCode.FAILED_PRECONDITION:
        console.log(`[youtube] Stream says the chat is gone (${end.codeName}: ${end.message}).`);
        return { next: 'chatEnded' };
      case GrpcCode.UNIMPLEMENTED:
      case GrpcCode.INVALID_ARGUMENT:
        console.warn(`[youtube] streamList was refused (${end.codeName}: ${end.message}). Using polling for this session.`);
        this.streamDisabled = true;
        return { next: 'poll' };
      default:
        return this.streamFailed(`${end.codeName}: ${end.message}`);
    }
  }

  private streamFailed(why: string, baseDelayMs = 2000): StreamResult {
    const now = Date.now();
    this.streamFailures = this.streamFailures.filter((t) => now - t < STREAM_FAILURE_WINDOW_MS);
    this.streamFailures.push(now);
    if (this.streamFailures.length >= STREAM_MAX_FAILURES) {
      console.warn(`[youtube] Streaming keeps failing (${why}). Using polling for the rest of this session.`);
      this.streamDisabled = true;
      return { next: 'poll' };
    }
    const delayMs = baseDelayMs * 2 ** (this.streamFailures.length - 1);
    console.warn(`[youtube] Stream dropped (${why}). Reconnecting in ${Math.round(delayMs / 1000)}s.`);
    return { next: 'reconnect', delayMs };
  }

  // ------------------------------------------------------------ polling

  private async pollOnce(chat: ChatTarget, saver: boolean): Promise<{ chatEnded: boolean; waitMs: number }> {
    try {
      const page = await this.api.listMessages(chat.liveChatId, this.pageToken);
      if (page.nextPageToken) this.pageToken = page.nextPageToken;
      const chatEnded = this.handleItems(page.items) || Boolean(page.offlineAt);
      const waitMs = Math.max(
        page.pollingIntervalMillis ?? 5000,
        this.config.minPollSeconds * 1000,
        saver ? this.config.saverPollSeconds * 1000 : 0,
      );
      return { chatEnded, waitMs };
    } catch (err) {
      if (err instanceof ApiError) {
        if (['liveChatEnded', 'liveChatNotFound', 'liveChatDisabled'].includes(err.reason)) return { chatEnded: true, waitMs: 0 };
        if (err.reason === 'rateLimitExceeded') return { chatEnded: false, waitMs: 10_000 };
      }
      throw err;
    }
  }

  // ------------------------------------------------------------ messages

  /** Emit events for new messages. Returns true if the chat has ended. */
  private handleItems(items: RawChatItem[] | undefined): boolean {
    let ended = false;
    for (const item of items ?? []) {
      if (!this.seen.add(item.id)) continue;
      const published = Date.parse(item.snippet?.publishedAt ?? '');
      if (Number.isFinite(published) && published < this.startedAt - BACKLOG_GRACE_MS) continue;
      const { events, chatEnded } = convertItem(item);
      if (chatEnded) ended = true;
      for (const e of events) this.emit(e);
    }
    return ended;
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0 || this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        resolve();
      }
      this.wake = done;
    });
  }
}

function describe(err: unknown): string {
  if (err instanceof ApiError) return `YouTube API error ${err.status} ${err.reason}: ${err.message}`;
  return (err as Error)?.message ?? String(err);
}
