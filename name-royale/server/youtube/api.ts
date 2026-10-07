// Plain REST calls to the YouTube Data API v3, using Node's built-in fetch.
// Every call is counted against the quota estimate.
import type { GameConfig } from '../../shared/config.ts';
import type { GoogleAuth } from './oauth.ts';
import type { QuotaTracker } from './quota.ts';
import type { RawChatItem } from './messages.ts';

const apiBase = (): string => process.env.NR_YT_API_BASE ?? 'https://youtube.googleapis.com/youtube/v3';

export class ApiError extends Error {
  status: number;
  reason: string;
  constructor(status: number, reason: string, message: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

export interface ChatTarget {
  liveChatId: string;
  title: string;
}

export interface ListPage {
  items: RawChatItem[];
  nextPageToken?: string;
  pollingIntervalMillis?: number;
  offlineAt?: string;
}

export class YouTubeApi {
  private auth: GoogleAuth;
  private quota: QuotaTracker;
  private config: GameConfig['youtube'];

  constructor(auth: GoogleAuth, quota: QuotaTracker, config: GameConfig['youtube']) {
    this.auth = auth;
    this.quota = quota;
    this.config = config;
  }

  private async get<T>(path: string, params: Record<string, string>, cost: number, label: string, retried = false): Promise<T> {
    const url = `${apiBase()}/${path}?${new URLSearchParams(params)}`;
    const token = await this.auth.accessToken();
    this.quota.spend(cost, label);
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (res.status === 401 && !retried) {
      this.auth.invalidate();
      return this.get(path, params, cost, label, true);
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; errors?: { reason?: string }[] } };
    if (!res.ok) {
      const reason = body.error?.errors?.[0]?.reason ?? 'unknown';
      throw new ApiError(res.status, reason, body.error?.message ?? `HTTP ${res.status}`);
    }
    return body;
  }

  /** Your channel's name, to confirm the sign-in picked the right account. */
  async myChannelName(): Promise<string | null> {
    const r = await this.get<{ items?: { snippet?: { title?: string } }[] }>(
      'channels',
      { part: 'snippet', mine: 'true' },
      this.config.costLookup,
      'lookup',
    );
    return r.items?.[0]?.snippet?.title ?? null;
  }

  /** The chat of your broadcast that's live right now, or null if you're not live. */
  async findActiveChat(): Promise<ChatTarget | null> {
    const r = await this.get<{ items?: { snippet?: { title?: string; liveChatId?: string } }[] }>(
      'liveBroadcasts',
      { part: 'snippet', broadcastStatus: 'active', broadcastType: 'all', maxResults: '5' },
      this.config.costLookup,
      'lookup',
    );
    const live = r.items?.find((b) => b.snippet?.liveChatId);
    return live ? { liveChatId: live.snippet!.liveChatId!, title: live.snippet!.title ?? '(untitled)' } : null;
  }

  /** The chat of a specific video (useful if your stream isn't found automatically). */
  async chatForVideo(videoId: string): Promise<ChatTarget | null> {
    const r = await this.get<{ items?: { snippet?: { title?: string }; liveStreamingDetails?: { activeLiveChatId?: string } }[] }>(
      'videos',
      { part: 'snippet,liveStreamingDetails', id: videoId },
      this.config.costLookup,
      'lookup',
    );
    const v = r.items?.[0];
    const id = v?.liveStreamingDetails?.activeLiveChatId;
    return id ? { liveChatId: id, title: v?.snippet?.title ?? videoId } : null;
  }

  async listMessages(liveChatId: string, pageToken?: string): Promise<ListPage> {
    const params: Record<string, string> = { liveChatId, part: 'snippet,authorDetails', maxResults: '2000' };
    if (pageToken) params.pageToken = pageToken;
    return this.get<ListPage>('liveChat/messages', params, this.config.costListCall, 'list');
  }
}

/** Accepts a bare video ID or any YouTube URL (watch?v=, youtu.be/, /live/, /shorts/). */
export function parseVideoId(input: string): string {
  const s = input.trim();
  const m = s.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : s;
}
